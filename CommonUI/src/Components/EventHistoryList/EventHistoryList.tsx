import type { FunctionComponent, ReactElement } from 'react';
import React from 'react';
import type { ComponentProps as EventHistoryDayListComponentProps } from './EventHistoryDayList';
import EventHistoryDayList from './EventHistoryDayList';

export interface ComponentProps {
    items: Array<EventHistoryDayListComponentProps>;
}

const ActiveEvent: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div className="event-history-box">
            {props.items.map(
                (item: EventHistoryDayListComponentProps, i: number) => {
                    return (
                        <EventHistoryDayList
                            key={i}
                            isLastItem={props.items.length - 1 === i}
                            {...item}
                        />
                    );
                }
            )}
        </div>
    );
};

export default ActiveEvent;
