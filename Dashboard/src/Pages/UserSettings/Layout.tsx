import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import DashboardSideMenu from './SideMenu';
import { Outlet } from 'react-router-dom';
import { getUserSettingsBreadcrumbs } from '../../Utils/Breadcrumbs/UserSettingsBreadcrumbs';
import Navigation from 'CommonUI/src/Utils/Navigation';

const UserSettingsLayout: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
    return (
        <Page
            title={'User Settings for Project ' + props.currentProject?.name}
            breadcrumbLinks={getUserSettingsBreadcrumbs(path)}
            sideMenu={<DashboardSideMenu />}
        >
            <Outlet />
        </Page>
    );
};

export default UserSettingsLayout;
