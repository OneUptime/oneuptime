import React, { Fragment, FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../../PageComponentProps';
import DashboardNavigation from '../../../Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import Navigation from 'CommonUI/src/Utils/Navigation';
import DisabledWarning from '../../../Components/Monitor/DisabledWarning';
import IncidentsTable from '../../../Components/Incident/IncidentsTable';

const MonitorIncidents: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    return (
        <Fragment>
            <DisabledWarning monitorId={modelId} />
            <IncidentsTable
                viewPageRoute={Navigation.getCurrentRoute()}
                query={{
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                    monitors: [modelId.toString()],
                }}
                createInitialValues={{
                    monitors: [modelId.toString()],
                }}
            />
        </Fragment>
    );
};

export default MonitorIncidents;
