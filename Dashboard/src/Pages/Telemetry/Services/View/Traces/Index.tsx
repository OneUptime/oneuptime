import React, { Fragment, FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../../../../PageComponentProps';
import GanttChart from 'CommonUI/src/Components/GanttChart/Index';
import Card from 'CommonUI/src/Components/Card/Card';

const ServiceDelete: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const [cardWidth, setCardWidth] = React.useState<number>(0);

    return (
        <Fragment>
            <Card
                onCardWidthChange={(width: number) => {
                    setCardWidth(width - 50 > 0 ? width - 50 : 0);
                }}
                title={'Traces'}
                description={'Traces for the request operation.'}
            >
                <div className="overflow-x-auto">
                    <GanttChart
                        chart={{
                            id: 'chart',
                            containerWidth: cardWidth,
                            rows: [],
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
