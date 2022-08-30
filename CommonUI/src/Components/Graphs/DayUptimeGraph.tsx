import { Green } from 'Common/Types/BrandColors';
import Color from 'Common/Types/Color';
import OneUptimeDate from 'Common/Types/Date';
import { Dictionary } from 'lodash';
import React, { FunctionComponent, ReactElement, useEffect, useState } from 'react';
import Tooltip from '../Tooltip/Toolip';

export interface Event {
    startDate: Date,
    endDate: Date,
    label: string,
    priority: number,
    color: Color
}


export interface ComponentProps {
    startDate: Date;
    endDate: Date;
    events: Array<Event>
}

const DayUptimeGraph: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    const [days, setDays] = useState<number>(0);

    useEffect(() => {
        setDays(OneUptimeDate.getNumberOfDaysBetweenDates(props.startDate, props.endDate));
    }, [props.startDate, props.endDate])

    const getUptimeBar = (dayNumber: number) => {
       
        let color: Color = Green;
        const todaysDay = OneUptimeDate.getSomeDaysAfterDate(props.startDate, dayNumber);
        let toolTipText: string = `${OneUptimeDate.getDateAsLocalFormattedString(todaysDay, true)}`;
        const startOfTheDay = OneUptimeDate.getStartOfDay(todaysDay);
        const endOfTheDay = OneUptimeDate.getEndOfDay(todaysDay);


        const events = props.events.filter((event) => {

            let doesEventBelongsToToday = false;


            /// if the event starts or end today. 
            if (OneUptimeDate.isBetween(event.startDate, startOfTheDay, endOfTheDay)) {
                doesEventBelongsToToday = true; 
            }

            if (OneUptimeDate.isBetween(event.endDate, startOfTheDay, endOfTheDay)) {
                doesEventBelongsToToday = true; 
            }

            // if the event is outside start or end day but overlaps the day completely. 

            if (OneUptimeDate.isBetween(startOfTheDay, event.startDate, endOfTheDay) && OneUptimeDate.isBetween(endOfTheDay, startOfTheDay, event.endDate)) {
                doesEventBelongsToToday = true; 
            }

            return doesEventBelongsToToday;

        });


        const secondsOfEvent: Dictionary<number> = {};

        let currentPriority: number = 1; 

        for (const event of events) {
            const startDate = OneUptimeDate.getGreaterDate(event.startDate, startOfTheDay);
            const endDate = OneUptimeDate.getLesserDate(event.endDate, endOfTheDay);

            const seconds = OneUptimeDate.getSecondsBetweenDates(startDate, endDate);

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

        let hasText = false; 
        for (const key in secondsOfEvent) {
            hasText = true; 
            toolTipText += `, ${key} for ${OneUptimeDate.secondsToFormattedTimeString(secondsOfEvent[key] || 0)}`;
        }

        if (!hasText) {
            toolTipText+= ' - 100% Uptime.'
        }


        return <Tooltip text={toolTipText || '100% Operational'}>
            <div className="uptime-bar" style={{ backgroundColor: color.toString() }}>

            </div>
        </Tooltip>
    }


    const getUptimeGraph = (): Array<ReactElement> => {

        const elements: Array<ReactElement> = [];

        for (let i = 0; i < days; i++) {
            elements.push(getUptimeBar(i));
        }

        return elements;
    }

    return (<div className='flex'>
        {getUptimeGraph()}
    </div>)
};

export default DayUptimeGraph;
