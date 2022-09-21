import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../PageComponentProps';
import RouteMap from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import Route from 'Common/Types/API/Route';
import IncidentsTable from '../../Components/Incident/IncidentsTable';
import SideMenu from './SideMenu';

const IncidentsPage: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    return (
        <Page
            title={'Incidents'}
            sideMenu={<SideMenu project={props.currentProject || undefined} />}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteMap[PageMap.HOME] as Route,
                },
                {
                    title: 'Incidents',
                    to: RouteMap[PageMap.INCIDENTS] as Route,
                },
                {
                    title: 'Unresolved Incidents',
                    to: RouteMap[PageMap.UNRESOLVED_INCIDENTS] as Route,
                },
            ]}
        >
            <IncidentsTable
                currentProject={props.currentProject || undefined}
                viewPageRoute={RouteMap[PageMap.INCIDENTS] as Route}
                query={{
                    projectId: props.currentProject?._id,
                    currentIncidentState: {
                        isResolvedState: false,
                    },
                }}
                noItemsMessage="Nice work! No unresolved incidents so far."
                title="Unresolved Incidents"
                description="Here is a list of all the unresolved incidents for this project."
            />
        </Page>
    );
};

export default IncidentsPage;
