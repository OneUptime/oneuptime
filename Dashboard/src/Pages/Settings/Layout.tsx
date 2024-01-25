import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import DashboardSideMenu from './SideMenu';
import { Outlet } from 'react-router-dom';
import { getSettingsBreadcrumbs } from '../../Utils/Breadcrumbs';
import Navigation from 'CommonUI/src/Utils/Navigation';

const SettingsLayout: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
    return (
        <Page
            title={'Project Settings'}
            breadcrumbLinks={getSettingsBreadcrumbs(path)}
            sideMenu={<DashboardSideMenu />}
        >
            <Outlet />
        </Page>
    );
};

export default SettingsLayout;
