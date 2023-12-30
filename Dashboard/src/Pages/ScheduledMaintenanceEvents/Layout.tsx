import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../PageComponentProps';
import { RouteUtil } from '../../Utils/RouteMap';
import SideMenu from './SideMenu';
import { Outlet } from 'react-router';
import { getScheduleMaintenanceBreadcrumbs } from '../../Utils/Breadcrumbs';
import Navigation from 'CommonUI/src/Utils/Navigation';
const ScheduledMaintenancesLayout: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
    return (
        <Page
            title={'Scheduled Maintenance Events'}
            sideMenu={<SideMenu project={props.currentProject || undefined} />}
            breadcrumbLinks={getScheduleMaintenanceBreadcrumbs(path)}
        >
            <Outlet />
        </Page>
    );
};

export default ScheduledMaintenancesLayout;
