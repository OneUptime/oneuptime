import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../PageComponentProps';
import { RouteUtil } from '../../Utils/RouteMap';
import SideMenu from './SideMenu';
import { Outlet } from 'react-router';
import { getIncidentsBreadcrumbs } from '../../Utils/Breadcrumbs/IncidentBreadcrumbs';
import Navigation from 'CommonUI/src/Utils/Navigation';

const IncidentsLayout: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
    return (
        <Page
            title={'Incidents'}
            sideMenu={<SideMenu project={props.currentProject || undefined} />}
            breadcrumbLinks={getIncidentsBreadcrumbs(path)}
        >
            <Outlet />
        </Page>
    );
};

export default IncidentsLayout;
