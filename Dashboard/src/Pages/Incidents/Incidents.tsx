import React, { FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../PageComponentProps';
import IncidentsTable from '../../Components/Incident/IncidentsTable';
import DashboardNavigation from '../../Utils/Navigation';
import Navigation from 'CommonUI/src/Utils/Navigation';

const IncidentsPage: FunctionComponent<
    PageComponentProps
> = (): ReactElement => {
    return (
        <IncidentsTable
            viewPageRoute={Navigation.getCurrentRoute()}
            query={{
                projectId: DashboardNavigation.getProjectId()?.toString(),
            }}
        />
    );
};

export default IncidentsPage;
