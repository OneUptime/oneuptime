import IncidentsTable from '../../Components/Incident/IncidentsTable';
import DashboardNavigation from '../../Utils/Navigation';
import PageComponentProps from '../PageComponentProps';
import Navigation from 'CommonUI/src/Utils/Navigation';
import React, { FunctionComponent, ReactElement } from 'react';

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
