import React, { Fragment, FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../../../../PageComponentProps';
import GanttChart from 'CommonUI/src/Components/GanttChart/Index';
import Card from 'CommonUI/src/Components/Card/Card';

const ServiceDelete: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {


    return (
        <Fragment>
            <Card
                title={'Traces'}
                description={'Traces for the request operation.'}
            >
                <div className="overflow-x-auto">
                    <GanttChart
                        chart={{
                            id: 'chart',
                            rows: [{
                                id: 'row1',
                                title: 'row1',
                                description: 'row1 description',
                            },
                            {
                                id: 'row2',
                                title: 'row2',
                                description: 'row2 description',
                            }],
                            bars: [],
                            timeline: {
                                start: 0,
                                end: 100,
                                interval: 10,
                                intervalUnit: 'ms',
                            },
                        }}
                    />
                </div>
            </Card>
        </Fragment>
    );
};

export default ServiceDelete;
