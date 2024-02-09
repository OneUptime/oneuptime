import React, { FunctionComponent, ReactElement } from 'react';
import RowLabel from './RowLabel';
import Bar, { GanttChartBar } from '../Bar/Index';


export interface GanttChartRow { 
    id: string;
    title: string;
    description: string;
    bars: GanttChartBar[];
}

export interface ComponentProps {
    row: GanttChartRow;
}

const Row: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        // rectangle div with curved corners and text inside in tailwindcss

        <div className='flex'>
            <div>
                <RowLabel title={props.row.title} description={props.row.description} />
            </div>
            <div className='flex'>
                {props.row.bars.map((bar: GanttChartBar) => {
                    return (
                        <Bar key={bar.id} bar={bar} />
                    );
                })}
            </div>
        </div>
    );
};

export default Row;
