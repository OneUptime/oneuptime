import OnCallDutyPolicyScheduleLayer from 'Model/Models/OnCallDutyPolicyScheduleLayer';
import OnCallDutyPolicyScheduleLayerUser from 'Model/Models/OnCallDutyPolicyScheduleLayerUser';
import React, { FunctionComponent, ReactElement } from 'react';
import Calendar from 'CommonUI/src/Components/Calendar/Calendar';
import FieldLabelElement from 'CommonUI/src/Components/Forms/Fields/FieldLabel';
import OneUptimeDate from 'Common/Types/Date';
import CalendarEvent from 'Common/Types/Calendar/CalendarEvent';
import LayerUtil from 'Common/Types/OnCallDutyPolicy/Layer';

export interface ComponentProps {
    layer: OnCallDutyPolicyScheduleLayer;
    layerUsers: Array<OnCallDutyPolicyScheduleLayerUser>;
    id?: string | undefined;
}

const LayerPreview: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
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
                    OneUptimeDate.getCurrentDate(),
                    OneUptimeDate.addRemoveWeeks(
                        OneUptimeDate.getCurrentDate(),
                        1
                    )
                )}
            />
        </div>
    );
};

export default LayerPreview;
