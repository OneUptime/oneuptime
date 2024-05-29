import DashboardLogsViewer from '../../../../../Components/Logs/LogsViewer';
import PageComponentProps from '../../../../PageComponentProps';
import ObjectID from 'Common/Types/ObjectID';
import Navigation from 'CommonUI/src/Utils/Navigation';
import React, { Fragment, FunctionComponent, ReactElement } from 'react';

const ServiceDelete: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    return (
        <Fragment>
            <DashboardLogsViewer
                showFilters={true}
                telemetryServiceIds={[modelId]}
                enableRealtime={false}
                id="logs"
            />
        </Fragment>
    );
};

export default ServiceDelete;
