import OnCallDutyPolicyScheduleLayer from 'Model/Models/OnCallDutyPolicyScheduleLayer';
import OnCallDutyPolicyScheduleLayerUser from 'Model/Models/OnCallDutyPolicyScheduleLayerUser';
import React, { FunctionComponent, ReactElement, useState } from 'react';
import Calendar from 'CommonUI/src/Components/Calendar/Calendar';
import FieldLabelElement from 'CommonUI/src/Components/Forms/Fields/FieldLabel';
import OneUptimeDate from 'Common/Types/Date';
import CalendarEvent from 'Common/Types/Calendar/CalendarEvent';
import LayerUtil from 'Common/Types/OnCallDutyPolicy/Layer';
import StartAndEndTime from 'Common/Types/Time/StartAndEndTime';

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

    const getCalendarEvents: Function = (
        calendarStartTime: Date,
        calendarEndTime: Date
    ): Array<CalendarEvent> => {
        return LayerUtil.getEvents({
            users: props.layerUsers,
            startDateTimeOfLayer: props.layer.startsAt!,
            calendarEndDate: calendarEndTime,
            calendarStartDate: calendarStartTime,
            handOffTime: props.layer.handOffTime!,
            rotation: props.layer.rotation!,
            restrictionTImes: props.layer.restrictionTimes!,
        });
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
                events={getCalendarEvents(
                    startTime,
                    endTime
                )}
                onRangeChange={(startEndTime: StartAndEndTime)=>{
                    setStartTime(startEndTime.startTime);
                    setEndTime(startEndTime.endTime);
                }}
            />
        </div>
    );
};

export default LayerPreview;
