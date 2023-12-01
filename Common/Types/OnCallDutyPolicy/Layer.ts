import UserModel from '../../Models/UserModel';
import Recurring from '../Events/Recurring';
import CalendarEvent from '../Calendar/CalendarEvent';
import RestrictionTimes, {
    RestrictionType,
    WeeklyResctriction,
} from './RestrictionTimes';
import OneUptimeDate from '../Date';
import EventInterval from '../Events/EventInterval';
import StartAndEndTime from '../Time/StartAndEndTime';
import Typeof from '../Typeof';

export default class LayerUtil {
    public static getEvents(data: {
        users: Array<UserModel>;
        startDateTimeOfLayer: Date;
        calendarStartDate: Date;
        calendarEndDate: Date;
        restrictionTimes: RestrictionTimes;
        handOffTime: Date;
        rotation: Recurring;
    }): Array<CalendarEvent> {
        let events: Array<CalendarEvent> = [];

        if(!LayerUtil.isDataValid(data)){
            return [];
        }

        data = LayerUtil.sanitizeData(data);

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

        currentUserIndex = LayerUtil.getCurrentUserIndexBasedOnHandoffTime({
            rotation,
            handOffTime,
            currentUserIndex,
            startDateTimeOfLayer: data.startDateTimeOfLayer,
            users: data.users,
        });

        // update handoff time to the same day as current start time

        handOffTime = LayerUtil.moveHandsOffTimeAfterCurrentEventStartTime({
            handOffTime,
            currentEventStartTime,
            rotation: data.rotation,
        });

    
        let currentEventEndTime: Date = OneUptimeDate.getCurrentDate(); // temporary set to current time to avoid typescript error

        while (!hasReachedTheEndOfTheCalendar) {
            if (rotation.intervalType === EventInterval.Day) {
                const daysToAdd: number = rotation.intervalCount.toNumber();
                currentEventEndTime = OneUptimeDate.addRemoveDays(
                    currentEventStartTime,
                    daysToAdd
                );
            } else if (rotation.intervalType === EventInterval.Week) {
                const weeksToAdd: number = rotation.intervalCount.toNumber();
                currentEventEndTime = OneUptimeDate.addRemoveWeeks(
                    currentEventStartTime,
                    weeksToAdd
                );
            } else if (rotation.intervalType === EventInterval.Month) {
                const monthsToAdd: number = rotation.intervalCount.toNumber();
                currentEventEndTime = OneUptimeDate.addRemoveMonths(
                    currentEventStartTime,
                    monthsToAdd
                );
            } else if (rotation.intervalType === EventInterval.Year) {
                const yearsToAdd: number = rotation.intervalCount.toNumber();
                currentEventEndTime = OneUptimeDate.addRemoveYears(
                    currentEventStartTime,
                    yearsToAdd
                );
            } else if (rotation.intervalType === EventInterval.Hour) {
                const hoursToAdd: number = rotation.intervalCount.toNumber();
                currentEventEndTime = OneUptimeDate.addRemoveHours(
                    currentEventStartTime,
                    hoursToAdd
                );
            }

            // if current event end time is after the handoff time, then we need to get events and update the user index.
            if (OneUptimeDate.isAfter(currentEventEndTime, handOffTime)) {
                const trimmedStartAndEndTimes: Array<StartAndEndTime> =
                    LayerUtil.trimStartAndEndTimesBasedOnRestrictionTimes({
                        eventStartTime: currentEventStartTime,
                        eventEndTime: handOffTime,
                        restrictionTimes: data.restrictionTimes,
                    });

                // update start time to handoff time
                currentEventStartTime = handOffTime;

                // update user index
                currentUserIndex = LayerUtil.incrementUserIndex(
                    currentUserIndex,
                    data.users.length
                );

                // add events to the array
                events = [
                    ...events,
                    ...LayerUtil.getCalendarEventsFromStartAndEndDates(
                        trimmedStartAndEndTimes,
                        data.users,
                        currentUserIndex
                    ),
                ];
            }

            // check calendar end time. if the end time of the event is after the end time of the calendar, we need to update the end time of the event
            if (OneUptimeDate.isAfter(currentEventEndTime, end)) {
                currentEventEndTime = end;
                hasReachedTheEndOfTheCalendar = true;
            }

            // check restriction times. if the end time of the event is after the end time of the restriction times, we need to update the end time of the event.

            const trimmedStartAndEndTimes: Array<StartAndEndTime> =
                LayerUtil.trimStartAndEndTimesBasedOnRestrictionTimes({
                    eventStartTime: currentEventStartTime,
                    eventEndTime: currentEventEndTime,
                    restrictionTimes: data.restrictionTimes,
                });

            events = [
                ...events,
                ...LayerUtil.getCalendarEventsFromStartAndEndDates(
                    trimmedStartAndEndTimes,
                    data.users,
                    currentUserIndex
                ),
            ];

            // update the current event start time

            currentEventStartTime = currentEventEndTime;

            // update the current user index
            currentUserIndex = LayerUtil.incrementUserIndex(
                currentUserIndex,
                data.users.length
            );
        }

        // increment ids of all the events and return them, to make sure they are unique

        let id: number = 1;

        for (const event of events) {
            event.id = id;
            id++;
        }

        return events;
    }
    
    private static sanitizeData(data: { users: Array<UserModel>; startDateTimeOfLayer: Date; calendarStartDate: Date; calendarEndDate: Date; restrictionTimes: RestrictionTimes; handOffTime: Date; rotation: Recurring; }): { users: Array<UserModel>; startDateTimeOfLayer: Date; calendarStartDate: Date; calendarEndDate: Date; restrictionTimes: RestrictionTimes; handOffTime: Date; rotation: Recurring; } {
        if(!(data.restrictionTimes instanceof RestrictionTimes)){
            data.restrictionTimes = RestrictionTimes.fromJSON(data.restrictionTimes);
        }

        if(!(data.rotation instanceof Recurring)){
            data.rotation = Recurring.fromJSON(data.rotation);
        }

        if(typeof data.startDateTimeOfLayer === Typeof.String){
            data.startDateTimeOfLayer = OneUptimeDate.fromString(data.startDateTimeOfLayer);
        }

        if(typeof data.calendarStartDate === Typeof.String){
            data.calendarStartDate = OneUptimeDate.fromString(data.calendarStartDate);
        }

        if(typeof data.calendarEndDate === Typeof.String){
            data.calendarEndDate = OneUptimeDate.fromString(data.calendarEndDate);
        }

        if(typeof data.handOffTime === Typeof.String){
            data.handOffTime = OneUptimeDate.fromString(data.handOffTime);
        }

        return data;
    }


    private static isDataValid(data: {
        calendarStartDate: Date;
        calendarEndDate: Date;
        startDateTimeOfLayer: Date;
        users: Array<UserModel>;
    }): boolean{
        // if calendar end time is before the start time then return an empty array.
        if (OneUptimeDate.isBefore(data.calendarEndDate, data.calendarStartDate)) {
            return false;
        }

        // end time of the layer is before the end time of the calendar, so, we dont have any events and we can return empty array
        if (OneUptimeDate.isAfter(data.startDateTimeOfLayer, data.calendarEndDate)) {
            return false;
        }

        // if users are empty, we dont have any events and we can return empty array
        if (data.users.length === 0) {
            return false;
        }

        return true; 
    }


    private static moveHandsOffTimeAfterCurrentEventStartTime(data: {
        handOffTime: Date;
        currentEventStartTime: Date;
        rotation: Recurring;
    }): Date {

        // if handoff time is ahead of the current event start time, then we dont need to move and we can return it as is.

        if(OneUptimeDate.isAfter(data.handOffTime, data.currentEventStartTime)){
            return data.handOffTime;
        }

        let handOffTime: Date = data.handOffTime;

        let intervalBetweenStartTimeAndHandoffTime: number = 0;
        const rotationInterval = data.rotation.intervalCount.toNumber();

        if(data.rotation.intervalType === EventInterval.Day){

            intervalBetweenStartTimeAndHandoffTime =
                OneUptimeDate.getDaysBetweenTwoDatesInclusive(
                    handOffTime,
                    data.currentEventStartTime
                );

                if(intervalBetweenStartTimeAndHandoffTime % rotationInterval !== 0){
                       intervalBetweenStartTimeAndHandoffTime += rotationInterval;  
                }

                // add intervalBetweenStartTimeAndHandoffTime to handoff time

                handOffTime = OneUptimeDate.addRemoveDays(
                    handOffTime,
                    intervalBetweenStartTimeAndHandoffTime
                );

                return handOffTime; 

        }

        if(data.rotation.intervalType === EventInterval.Hour){

            intervalBetweenStartTimeAndHandoffTime =
                OneUptimeDate.getHoursBetweenTwoDatesInclusive(
                    handOffTime,
                    data.currentEventStartTime
                );

                if(intervalBetweenStartTimeAndHandoffTime % rotationInterval !== 0){
                       intervalBetweenStartTimeAndHandoffTime += rotationInterval;  
                }

                // add intervalBetweenStartTimeAndHandoffTime to handoff time

                handOffTime = OneUptimeDate.addRemoveHours(
                    handOffTime,
                    intervalBetweenStartTimeAndHandoffTime
                );

                return handOffTime; 

        }

        if(data.rotation.intervalType === EventInterval.Week){

            intervalBetweenStartTimeAndHandoffTime =
                OneUptimeDate.getWeeksBetweenTwoDatesInclusive(
                    handOffTime,
                    data.currentEventStartTime
                );

    
                if(intervalBetweenStartTimeAndHandoffTime % rotationInterval !== 0){
                       intervalBetweenStartTimeAndHandoffTime += rotationInterval;  
                }

                // add intervalBetweenStartTimeAndHandoffTime to handoff time

                handOffTime = OneUptimeDate.addRemoveWeeks(
                    handOffTime,
                    intervalBetweenStartTimeAndHandoffTime
                );

                return handOffTime; 

        }

        if(data.rotation.intervalType === EventInterval.Month){

            intervalBetweenStartTimeAndHandoffTime =
                OneUptimeDate.getMonthsBetweenTwoDatesInclusive(
                    handOffTime,
                    data.currentEventStartTime
                    
                );

                if(intervalBetweenStartTimeAndHandoffTime % rotationInterval !== 0){
                       intervalBetweenStartTimeAndHandoffTime += rotationInterval;  
                }

                // add intervalBetweenStartTimeAndHandoffTime to handoff time

                handOffTime = OneUptimeDate.addRemoveMonths(
                    handOffTime,
                    intervalBetweenStartTimeAndHandoffTime
                );

                return handOffTime; 

        }


        if(data.rotation.intervalType === EventInterval.Year){

            intervalBetweenStartTimeAndHandoffTime =
                OneUptimeDate.getYearsBetweenTwoDatesInclusive(
                    handOffTime,
                    data.currentEventStartTime
                    
                );

                if(intervalBetweenStartTimeAndHandoffTime % rotationInterval !== 0){
                       intervalBetweenStartTimeAndHandoffTime += rotationInterval;  
                }

                // add intervalBetweenStartTimeAndHandoffTime to handoff time

                handOffTime = OneUptimeDate.addRemoveYears(
                    handOffTime,
                    intervalBetweenStartTimeAndHandoffTime
                );

                return handOffTime; 

        }

    
        return handOffTime;
    }


    private static getCurrentUserIndexBasedOnHandoffTime(data: {
        rotation: Recurring;
        handOffTime: Date;
        currentUserIndex: number;
        startDateTimeOfLayer: Date;
        users: Array<UserModel>;
    }): number {
        let intervalBetweenStartTimeAndHandoffTime: number = 0;
        let rotation: Recurring = data.rotation;
        let handOffTime: Date = data.handOffTime;
        let currentUserIndex: number = data.currentUserIndex;

        if (rotation.intervalType === EventInterval.Day) {
            // calculate the number of days between the start time of the layer and the handoff time.
            intervalBetweenStartTimeAndHandoffTime =
                OneUptimeDate.getDaysBetweenTwoDatesInclusive(
                    data.startDateTimeOfLayer,
                    handOffTime
                );
        }

        if (rotation.intervalType === EventInterval.Hour) {
            // calculate the number of hours between the start time of the layer and the handoff time.
            intervalBetweenStartTimeAndHandoffTime =
                OneUptimeDate.getHoursBetweenTwoDatesInclusive(
                    data.startDateTimeOfLayer,
                    handOffTime
                );
        }

        if (rotation.intervalType === EventInterval.Week) {
            // calculate the number of weeks between the start time of the layer and the handoff time.
            intervalBetweenStartTimeAndHandoffTime =
                OneUptimeDate.getWeeksBetweenTwoDatesInclusive(
                    data.startDateTimeOfLayer,
                    handOffTime
                );
        }

        if (rotation.intervalType === EventInterval.Month) {
            // calculate the number of months between the start time of the layer and the handoff time.
            intervalBetweenStartTimeAndHandoffTime =
                OneUptimeDate.getMonthsBetweenTwoDatesInclusive(
                    data.startDateTimeOfLayer,
                    handOffTime
                );
        }

        if (rotation.intervalType === EventInterval.Year) {
            // calculate the number of years between the start time of the layer and the handoff time.
            intervalBetweenStartTimeAndHandoffTime =
                OneUptimeDate.getYearsBetweenTwoDatesInclusive(
                    data.startDateTimeOfLayer,
                    handOffTime
                );
        }

        // now divide the interval between start time and handoff time by the interval count.

        const numberOfIntervalsBetweenStartAndHandoffTime: number = Math.floor(
            intervalBetweenStartTimeAndHandoffTime /
            rotation.intervalCount.toNumber()
        ) - 1;
        
        if(numberOfIntervalsBetweenStartAndHandoffTime < 0){
            return currentUserIndex;
        }

        currentUserIndex = LayerUtil.incrementUserIndex(
            currentUserIndex,
            data.users.length,
            numberOfIntervalsBetweenStartAndHandoffTime
        );

        return currentUserIndex;
    }



    public static trimStartAndEndTimesBasedOnRestrictionTimes(data: {
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

        if (restrictionTimes.restictionType === RestrictionType.Daily) {
            return LayerUtil.getEventsByDailyRestriction(data);
        }

        if (restrictionTimes.restictionType === RestrictionType.Weekly) {
            return LayerUtil.getEventsByWeeklyRestriction(data);
        }

        return [];
    }

    public static getEventsByWeeklyRestriction(data: {
        eventStartTime: Date;
        eventEndTime: Date;
        restrictionTimes: RestrictionTimes;
    }): Array<StartAndEndTime> {
        const weeklyRestrictionTimes: Array<WeeklyResctriction> =
            data.restrictionTimes.weeklyRestrictionTimes;

        // if there are no weekly restriction times, we dont have any restrictions and we can return the event start and end times

        const trimmedStartAndEndTimes: Array<StartAndEndTime> = [];

        if (
            !weeklyRestrictionTimes ||
            weeklyRestrictionTimes.length === 0
        ) {
            return [
                {
                    startTime: data.eventStartTime,
                    endTime: data.eventEndTime,
                },
            ];
        }

        // const eventStartTime: Date = data.eventStartTime;
        // const eventStartDayOfWeek: DayOfWeek = OneUptimeDate.getDayOfWeek(eventStartTime);

        return trimmedStartAndEndTimes;
    }

    public static getEventsByDailyRestriction(data: {
        eventStartTime: Date;
        eventEndTime: Date;
        restrictionTimes: RestrictionTimes;
    }): Array<StartAndEndTime> {
        const dayRestrictionTimes: StartAndEndTime | null =
            data.restrictionTimes.dayRestrictionTimes;

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

        while (!reachedTheEndOfTheCurrentEvent) {
            // if current end time is equalto or before than the current start time, we need to return the current event and exit the loop

            if (OneUptimeDate.isBefore(currentEndTime, currentStartTime)) {
                reachedTheEndOfTheCurrentEvent = true;
            }

            // before this we need to make sure restrciton times are moved to the day of the event.
            restrictionStartTime = OneUptimeDate.keepTimeButMoveDay(
                restrictionStartTime,
                data.eventStartTime
            );
            restrictionEndTime = OneUptimeDate.keepTimeButMoveDay(
                restrictionEndTime,
                data.eventStartTime
            );

            // if the restriction end time is before the restriction start time, we need to add one day to the restriction end time
            if (
                OneUptimeDate.isAfter(
                    restrictionStartTime,
                    restrictionEndTime
                )
            ) {
                restrictionEndTime = OneUptimeDate.addRemoveDays(
                    restrictionEndTime,
                    1
                );
            }

            // 1 - if the current event falls within the restriction times, we need to return the current event.

            if (
                OneUptimeDate.isOnOrAfter(
                    currentStartTime,
                    restrictionStartTime
                ) &&
                OneUptimeDate.isOnOrAfter(
                    restrictionEndTime,
                    currentEndTime
                )
            ) {
                trimmedStartAndEndTimes.push({
                    startTime: currentStartTime,
                    endTime: currentEndTime,
                });
                reachedTheEndOfTheCurrentEvent = true;
            }

            // 2 - Start Restriction: If the current event starts after the restriction start time and ends after the restriction end time, we need to return the current event with the start time of the current event and end time of the restriction

            if (
                OneUptimeDate.isOnOrAfter(
                    currentStartTime,
                    restrictionStartTime
                ) &&
                OneUptimeDate.isOnOrAfter(
                    currentEndTime,
                    restrictionEndTime
                )
            ) {
                trimmedStartAndEndTimes.push({
                    startTime: currentStartTime,
                    endTime: restrictionEndTime,
                });
                reachedTheEndOfTheCurrentEvent = true;
            }

            // 3 - End Restriction - If the current event starts before the restriction start time and ends before the restriction end time, we need to return the current event with the start time of the restriction and end time of the current event.

            if (
                OneUptimeDate.isBefore(
                    currentStartTime,
                    restrictionStartTime
                ) &&
                OneUptimeDate.isBefore(currentEndTime, restrictionEndTime)
            ) {
                trimmedStartAndEndTimes.push({
                    startTime: restrictionStartTime,
                    endTime: currentEndTime,
                });
                reachedTheEndOfTheCurrentEvent = true;
            }

            // 4 - If the current event starts before the restriction start time and ends after the restriction end time, we need to return the current event with the start time of the restriction and end time of the restriction.

            if (
                OneUptimeDate.isBefore(
                    currentStartTime,
                    restrictionStartTime
                ) &&
                OneUptimeDate.isOnOrAfter(
                    currentEndTime,
                    restrictionEndTime
                )
            ) {
                trimmedStartAndEndTimes.push({
                    startTime: restrictionStartTime,
                    endTime: restrictionEndTime,
                });

                currentStartTime = restrictionEndTime;

                // add day to restriction start and end times.

                restrictionStartTime = OneUptimeDate.addRemoveDays(
                    restrictionStartTime,
                    1
                );
                restrictionEndTime = OneUptimeDate.addRemoveDays(
                    restrictionEndTime,
                    1
                );
            }
        }

        return trimmedStartAndEndTimes;
    }

    // helper functions.

    private static incrementUserIndex(
        currentIndex: number,
        userArrayLength: number,
        incrementBy?: number
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

    private static getCalendarEventsFromStartAndEndDates(
        trimmedStartAndEndTimes: Array<StartAndEndTime>,
        users: Array<UserModel>,
        currentUserIndex: number
    ): Array<CalendarEvent> {
        const events: Array<CalendarEvent> = [];

        const userId: string = users[currentUserIndex]?.id?.toString() || '';

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
}
