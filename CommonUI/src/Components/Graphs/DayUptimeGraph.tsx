import { Green } from 'Common/Types/BrandColors';
import Color from 'Common/Types/Color';
import OneUptimeDate from 'Common/Types/Date';
import { Dictionary } from 'lodash';
import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import Tooltip from '../Tooltip/Toolip';

export interface Event {
    startDate: Date;
    endDate: Date;
    label: string;
    priority: number;
    color: Color;
}

export interface ComponentProps {
    startDate: Date;
    endDate: Date;
    events: Array<Event>;
    defaultLabel: string;
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

    const getUptimeBar: Function = (dayNumber: number): ReactElement => {
        let color: Color = Green;
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

            if (!secondsOfEvent[event.label]) {
                secondsOfEvent[event.label] = 0;
            }

            secondsOfEvent[event.label] += seconds;

            // set bar color.
            if (currentPriority <= event.priority) {
                currentPriority = event.priority;
                color = event.color;
            }
        }

        let hasText: boolean = false;
        for (const key in secondsOfEvent) {
            if (todaysEvents.length === 1) {
                break;
            }

            hasText = true;
            toolTipText += `, ${key} for ${OneUptimeDate.secondsToFormattedFriendlyTimeString(
                secondsOfEvent[key] || 0
            )}`;
        }

        if (todaysEvents.length === 1) {
            hasText = true;
            toolTipText += ` - 100% ${
                todaysEvents[0]?.label || 'Operational'
            }.`;
        }

        if (!hasText) {
            toolTipText += ` - 100% ${props.defaultLabel || 'Operational'}.`;
        }

        return (
            <Tooltip key={dayNumber} text={toolTipText || '100% Operational'}>
                <div
                    className="rounded h-20 w-20"
                    style={{
                        backgroundColor: color.toString(),
                    }}
                ></div>
            </Tooltip>
        );
    };

    const getUptimeGraph: Function = (): Array<ReactElement> => {
        const elements: Array<ReactElement> = [];

        for (let i: number = 0; i < days; i++) {
            elements.push(getUptimeBar(i));
        }

        return elements;
    };

    return <div className="flex space-x-1">{getUptimeGraph()}</div>;
};

export default DayUptimeGraph;
