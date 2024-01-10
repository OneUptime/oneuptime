import React, { Fragment, FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../../../../PageComponentProps';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import DashboardLogsViewer from '../../../../../Components/LogsViewer/LogsViewer';

const ServiceDelete: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    return (
        <Fragment>
            <DashboardLogsViewer telemetryServiceIds={[modelId]} id="logs" />
        </Fragment>
    );
};

export default ServiceDelete;
