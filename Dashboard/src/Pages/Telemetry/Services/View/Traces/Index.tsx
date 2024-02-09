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
                <GanttChart
                    chart={{
                        id: 'service-delete',
                    }}
                />
            </Card>
        </Fragment>
    );
};

export default ServiceDelete;
