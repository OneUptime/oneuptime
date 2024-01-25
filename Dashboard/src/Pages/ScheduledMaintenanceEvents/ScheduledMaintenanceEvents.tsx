import React, { FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../PageComponentProps';
import ScheduledMaintenancesTable from '../../Components/ScheduledMaintenance/ScheduledMaintenanceTable';
import Navigation from 'CommonUI/src/Utils/Navigation';
import { useParams } from 'react-router-dom';
import ObjectID from 'Common/Types/ObjectID';
const ScheduledMaintenancesPage: FunctionComponent<
    PageComponentProps
> = (): ReactElement => {
    const { projectId } = useParams();
    const projectObjectId: ObjectID = new ObjectID(projectId || '');
    return (
        <ScheduledMaintenancesTable
            viewPageRoute={Navigation.getCurrentRoute()}
            query={{
                projectId: projectObjectId,
            }}
        />
    );
};

export default ScheduledMaintenancesPage;
