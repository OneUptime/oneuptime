import Tooltip from '../Tooltip/Tooltip';
import { Green } from 'Common/Types/BrandColors';
import Color from 'Common/Types/Color';
import OneUptimeDate from 'Common/Types/Date';
import Dictionary from 'Common/Types/Dictionary';
import ObjectID from 'Common/Types/ObjectID';
import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';

export interface Event {
    startDate: Date;
    endDate: Date;
    label: string;
    priority: number;
    color: Color;
    eventStatusId: ObjectID; // this is the id of the event status. for example, monitor status id.
}

export interface BarChartRule {
    barColor: Color;
    uptimePercentGreaterThanOrEqualTo: number;
}

export interface ComponentProps {
    startDate: Date;
    endDate: Date;
    events: Array<Event>;
    height?: number | undefined;
    barColorRules?: Array<BarChartRule> | undefined;
    downtimeEventStatusIds?: Array<ObjectID> | undefined;
    defaultBarColor: Color;
}

const DayUptimeGraph: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [days, setDays] = useState<number>(0);

    useEffect(() => {
        setDays(
            OneUptimeDate.getNumberOfDaysBetweenDatesInclusive(
                props.startDate,
                props.endDate
            )
        );
    }, [props.startDate, props.endDate]);

    type GetUptimeBarFunction = (dayNumber: number) => ReactElement;

    const getUptimeBar: GetUptimeBarFunction = (
        dayNumber: number
    ): ReactElement => {
        let color: Color = props.defaultBarColor || Green;

        const todaysDay: Date = OneUptimeDate.getSomeDaysAfterDate(
            props.startDate,
            dayNumber
        );

        let toolTipText: string = `${OneUptimeDate.getDateAsLocalFormattedString(
            todaysDay,
            true
        )}`;

        const startOfTheDay: Date = OneUptimeDate.getStartOfDay(todaysDay);
        const endOfTheDay: Date = OneUptimeDate.getEndOfDay(todaysDay);

        const todaysEvents: Array<Event> = props.events.filter(
            (event: Event) => {
                let doesEventBelongsToToday: boolean = false;

                /// if the event starts or end today.
                if (
                    OneUptimeDate.isBetween(
                        event.startDate,
                        startOfTheDay,
                        endOfTheDay
                    )
                ) {
                    doesEventBelongsToToday = true;
                }

                if (
                    OneUptimeDate.isBetween(
                        event.endDate,
                        startOfTheDay,
                        endOfTheDay
                    )
                ) {
                    doesEventBelongsToToday = true;
                }

                // if the event is outside start or end day but overlaps the day completely.

                if (
                    OneUptimeDate.isBetween(
                        startOfTheDay,
                        event.startDate,
                        endOfTheDay
                    ) &&
                    OneUptimeDate.isBetween(
                        endOfTheDay,
                        startOfTheDay,
                        event.endDate
                    )
                ) {
                    doesEventBelongsToToday = true;
                }

                return doesEventBelongsToToday;
            }
        );

        const secondsOfEvent: Dictionary<number> = {};

        let currentPriority: number = 1;

        const eventLabels: Dictionary<string> = {};

        for (const event of todaysEvents) {
            const startDate: Date = OneUptimeDate.getGreaterDate(
                event.startDate,
                startOfTheDay
            );

            const endDate: Date = OneUptimeDate.getLesserDate(
                event.endDate,
                OneUptimeDate.getLesserDate(
                    OneUptimeDate.getCurrentDate(),
                    endOfTheDay
                )
            );

            const seconds: number = OneUptimeDate.getSecondsBetweenDates(
                startDate,
                endDate
            );

            if (!secondsOfEvent[event.eventStatusId.toString()]) {
                secondsOfEvent[event.eventStatusId.toString()] = 0;
            }

            secondsOfEvent[event.eventStatusId.toString()] += seconds;

            eventLabels[event.eventStatusId.toString()] = event.label;

            // set bar color.
            if (currentPriority <= event.priority) {
                currentPriority = event.priority;

                // if there are no rules then use the color of the event.

                if (!props.barColorRules || props.barColorRules.length === 0) {
                    color = event.color;
                }
            }
        }

        let hasEvents: boolean = false;

        let totalDowntimeInSeconds: number = 0;

        let totalUptimeInSeconds: number = 0;

        for (const key in secondsOfEvent) {
            hasEvents = true;

            const eventStatusId: string = key;

            // if this is downtime state then, include tooltip.

            if (
                (props.downtimeEventStatusIds?.filter((id: ObjectID) => {
                    return id.toString() === eventStatusId.toString();
                }).length || 0) > 0
            ) {
                toolTipText += `, ${
                    eventLabels[key]
                } for ${OneUptimeDate.secondsToFormattedFriendlyTimeString(
                    secondsOfEvent[key] || 0
                )}`;
            }

            const isDowntimeEvent: boolean = Boolean(
                props.downtimeEventStatusIds?.find((id: ObjectID) => {
                    return id.toString() === eventStatusId;
                })
            );

            if (isDowntimeEvent) {
                // remove the seconds from total uptime.
                const secondsOfDowntime: number = secondsOfEvent[key] || 0;
                totalDowntimeInSeconds += secondsOfDowntime;
            } else {
                totalUptimeInSeconds += secondsOfEvent[key] || 0;
            }
        }

        // now check bar rules and finalize the color of the bar

        const uptimePercentForTheDay: number =
            (totalUptimeInSeconds /
                (totalDowntimeInSeconds + totalUptimeInSeconds)) *
            100;

        for (const rules of props.barColorRules || []) {
            if (
                uptimePercentForTheDay >=
                rules.uptimePercentGreaterThanOrEqualTo
            ) {
                color = rules.barColor;
                break;
            }
        }

        if (todaysEvents.length === 1) {
            hasEvents = true;
            toolTipText = `${OneUptimeDate.getDateAsLocalFormattedString(
                todaysDay,
                true
            )} - 100% ${todaysEvents[0]?.label || 'Operational'}.`;
        }

        if (!hasEvents) {
            toolTipText += ` - No data for this day.`;
            color = props.defaultBarColor || Green;
        }

        let className: string = 'h-20 w-20';

        if (props.height) {
            className = 'w-20 h-' + props.height;
        }
        return (
            <Tooltip key={dayNumber} text={toolTipText || '100% Operational'}>
                <div
                    className={className}
                    style={{
                        backgroundColor: color.toString(),
                    }}
                ></div>
            </Tooltip>
        );
    };

    type GetUptimeGraphFunction = () => Array<ReactElement>;

    const getUptimeGraph: GetUptimeGraphFunction = (): Array<ReactElement> => {
        const elements: Array<ReactElement> = [];

        for (let i: number = 0; i < days; i++) {
            elements.push(getUptimeBar(i));
        }

        return elements;
    };

    return (
        <div className="flex space-x-0.5 rounded overflow-hidden">
            {getUptimeGraph()}
        </div>
    );
};

export default DayUptimeGraph;
