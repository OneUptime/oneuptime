import Color from 'Common/Types/Color';
import OneUptimeDate from 'Common/Types/Date';
import React, { FunctionComponent, ReactElement } from 'react';
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

    const days = OneUptimeDate.getNumberOfDaysBetweenDates(props.startDate, props.endDate);


    const getUptimeBar = () => {

        return <Tooltip text='100% Uptime'>
            <div className="uptime-bar">

            </div>
        </Tooltip>
    }


    const getUptimeGraph = (): Array<ReactElement> => {

        const elements: Array<ReactElement> = [];



        for (let i = 0; i < days; i++) {
            elements.push(getUptimeBar());
        }

        return elements;
    }

    return (<div className='flex'>
        {getUptimeGraph()}
    </div>)
};

export default DayUptimeGraph;
