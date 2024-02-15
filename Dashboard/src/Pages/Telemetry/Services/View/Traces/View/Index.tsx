import React, { Fragment, FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../../../../../PageComponentProps';
import GanttChart from 'CommonUI/src/Components/GanttChart/Index';
import Card from 'CommonUI/src/Components/Card/Card';
import { Black, White } from 'Common/Types/BrandColors';

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
                            rows: [
                                {
                                    id: 'row1',
                                    title: 'row1',
                                    description: 'row1 description',
                                },
                                {
                                    id: 'row2',
                                    title: 'row2',
                                    description: 'row2 description',
                                },
                            ],
                            bars: [
                                {
                                    id: 'bar-1',
                                    title: 'Bar 1',
                                    titleColor: White,
                                    barColor: Black,
                                    barTimelineStart: 20,
                                    barTimelineEnd: 80,
                                    rowId: 'row1',
                                },
                                {
                                    id: 'bar-2',
                                    title: 'Bar 2',
                                    titleColor: White,
                                    barColor: Black,
                                    barTimelineStart: 90,
                                    barTimelineEnd: 100,
                                    rowId: 'row1',
                                },
                                {
                                    id: 'bar-3',
                                    title: 'Bar 3',
                                    titleColor: White,
                                    barColor: Black,
                                    barTimelineStart: 45,
                                    barTimelineEnd: 65,
                                    rowId: 'row2',
                                },
                            ],
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
