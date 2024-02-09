import React, { Fragment, FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../../../../PageComponentProps';
import GanttChart from 'CommonUI/src/Components/GanttChart/Index';

const ServiceDelete: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    return (
        <Fragment>
            <GanttChart chart={{
                id: 'service-delete'
            }} />
        </Fragment>
    );
};

export default ServiceDelete;
