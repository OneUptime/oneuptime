import OnCallDutyPolicyScheduleLayer from 'Model/Models/OnCallDutyPolicyScheduleLayer';
import OnCallDutyPolicyScheduleLayerUser from 'Model/Models/OnCallDutyPolicyScheduleLayerUser';
import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import Calendar from 'CommonUI/src/Components/Calendar/Calendar';
import FieldLabelElement from 'CommonUI/src/Components/Forms/Fields/FieldLabel';
import OneUptimeDate from 'Common/Types/Date';
import CalendarEvent from 'Common/Types/Calendar/CalendarEvent';
import LayerUtil, { LayerProps } from 'Common/Types/OnCallDutyPolicy/Layer';
import StartAndEndTime from 'Common/Types/Time/StartAndEndTime';
import { Blue, EventColorList } from 'Common/Types/BrandColors';
import HashCode from 'Common/Types/HashCode';
import User from 'Model/Models/User';
import Color from 'Common/Types/Color';
import Dictionary from 'Common/Types/Dictionary';

export interface ComponentProps {
    layers: Array<OnCallDutyPolicyScheduleLayer>;
    allLayerUsers: Dictionary<Array<OnCallDutyPolicyScheduleLayerUser>>;
    id?: string | undefined;
}

const LayersPreview: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [startTime, setStartTime] = useState<Date>(
        OneUptimeDate.getStartOfDay(OneUptimeDate.getCurrentDate())
    );
    const [endTime, setEndTime] = useState<Date>(
        OneUptimeDate.getEndOfDay(OneUptimeDate.getCurrentDate())
    );

    const [calendarEvents, setCalendarEvents] = useState<Array<CalendarEvent>>(
        []
    );

    useEffect(() => {
        setCalendarEvents(getCalendarEvents(startTime, endTime));
    }, [props.layers, props.allLayerUsers, startTime, endTime]);

    const getCalendarEvents: Function = (
        calendarStartTime: Date,
        calendarEndTime: Date
    ): Array<CalendarEvent> => {

        const layerProps: Array<LayerProps> = [];

        const users: Array<User> = [];

        for(const key in props.allLayerUsers) {
            const layerUsers: Array<OnCallDutyPolicyScheduleLayerUser> = props.allLayerUsers[key] || [];

            for(const layerUser of layerUsers) {
                users.push(layerUser.user!);
            }
        }

        for (const layer of props.layers) {
            const layerUsers: Array<OnCallDutyPolicyScheduleLayerUser> = props.allLayerUsers[layer.id?.toString() || ''] || [];

            layerProps.push({
                users: layerUsers.map((layerUser: OnCallDutyPolicyScheduleLayerUser) => {
                    return layerUser.user!;
                }),
                startDateTimeOfLayer: layer.startsAt!,
                handOffTime: layer.handOffTime!,
                rotation: layer.rotation!,
                restrictionTimes: layer.restrictionTimes!,
            });
        }

        const events: Array<CalendarEvent> = LayerUtil.getMultiLayerEvents({
            calendarEndDate: calendarEndTime,
            calendarStartDate: calendarStartTime,
            layers: layerProps,
        })

        // Assign colors to each user based on id. Hash the id and mod it by the length of the color list.

        const colorListLength: number = EventColorList.length;

        events.forEach((event: CalendarEvent) => {
            const userId: string = event.title;

            const user: User | undefined = users.find((user: User) => {
                return user.id?.toString() === userId;
            });

            if (!user) {
                return;
            }

            const colorIndex: number =
                HashCode.fromString(userId) % colorListLength;

            event.color =
                (EventColorList[colorIndex] as Color)?.toString() ||
                Blue.toString();

            event.title = `${(user.name?.toString() || '') +
                ' ' +
                '(' +
                (user.email?.toString() || '') +
                ')'
                }`;
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
                onRangeChange={(startEndTime: StartAndEndTime) => {
                    setStartTime(startEndTime.startTime);
                    setEndTime(startEndTime.endTime);
                }}
            />
        </div>
    );
};

export default LayersPreview;
