import OnCallDutyPolicyScheduleLayer from 'Model/Models/OnCallDutyPolicyScheduleLayer';
import OnCallDutyPolicyScheduleLayerUser from 'Model/Models/OnCallDutyPolicyScheduleLayerUser';
import React, { FunctionComponent, ReactElement, useEffect, useState } from 'react';
import Calendar from 'CommonUI/src/Components/Calendar/Calendar';
import FieldLabelElement from 'CommonUI/src/Components/Forms/Fields/FieldLabel';
import OneUptimeDate from 'Common/Types/Date';
import CalendarEvent from 'Common/Types/Calendar/CalendarEvent';
import LayerUtil from 'Common/Types/OnCallDutyPolicy/Layer';
import StartAndEndTime from 'Common/Types/Time/StartAndEndTime';
import { EventColorList } from 'Common/Types/BrandColors';
import HashCode from 'Common/Types/HashCode';
import User from 'Model/Models/User';
import Color from 'Common/Types/Color';

export interface ComponentProps {
    layer: OnCallDutyPolicyScheduleLayer;
    layerUsers: Array<OnCallDutyPolicyScheduleLayerUser>;
    id?: string | undefined;
}

const LayerPreview: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    const [startTime, setStartTime] = useState<Date>(OneUptimeDate.getStartOfDay(OneUptimeDate.getCurrentDate()));
    const [endTime, setEndTime] = useState<Date>(OneUptimeDate.getEndOfDay(OneUptimeDate.getCurrentDate()));

    const [calendarEvents, setCalendarEvents] = useState<Array<CalendarEvent>>([]);

    useEffect(()=>{
        setCalendarEvents(getCalendarEvents(startTime, endTime));
    }, [props.layer, props.layerUsers, startTime, endTime])

    const getCalendarEvents: Function = (
        calendarStartTime: Date,
        calendarEndTime: Date
    ): Array<CalendarEvent> => {

        const users: Array<User> = props.layerUsers.map((layerUser: OnCallDutyPolicyScheduleLayerUser)=>{
            return layerUser.user!;
        });

        const events: Array<CalendarEvent> =  LayerUtil.getEvents({
            users: users,
            startDateTimeOfLayer: props.layer.startsAt!,
            calendarEndDate: calendarEndTime,
            calendarStartDate: calendarStartTime,
            handOffTime: props.layer.handOffTime!,
            rotation: props.layer.rotation!,
            restrictionTimes: props.layer.restrictionTimes!,
        });

        // Assign colors to each user based on id. Hash the id and mod it by the length of the color list.

        const colorListLength = EventColorList.length;

        events.forEach((event: CalendarEvent)=>{

            const userId: string = event.title; 

            const user: User | undefined = users.find((user: User)=>{
                return user.id?.toString() === userId;
            });

            if(!user){
                return;
            }

            const colorIndex: number = HashCode.fromString(userId) % colorListLength;

            event.color = (EventColorList[colorIndex] as Color).toString();

            event.title = `${(user.name?.toString() || '')+' '+'('+(user.email?.toString() || '')+')'}`;
        });

        return events;
    };

    return (
        <div id={props.id}>
            <FieldLabelElement
                required={true}
                title="Layer Preview"
                description={
                    'Here is a preview of who is on call and when. This is based on your local timezone - ' +
                    OneUptimeDate.getCurrentTimezoneString()
                }
            />
            <Calendar
                events={calendarEvents}
                onRangeChange={(startEndTime: StartAndEndTime)=>{
                    setStartTime(startEndTime.startTime);
                    setEndTime(startEndTime.endTime);
                }}
            />
        </div>
    );
};

export default LayerPreview;
