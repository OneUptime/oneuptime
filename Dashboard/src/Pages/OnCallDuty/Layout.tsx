import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import DashboardSideMenu from './SideMenu';
import { Outlet } from 'react-router-dom';
import Dictionary from 'Common/Types/Dictionary';
import Navigation from 'CommonUI/src/Utils/Navigation';
import { getOnCallDutyBreadcrumbs } from '../../Utils/Breadcrumbs';

const PageTitleMap: Dictionary<string> = {
    [RouteUtil.getLastPathForKey(PageMap.ON_CALL_DUTY_POLICIES)]:
        'On-Call Duty Policies',
    [RouteUtil.getLastPathForKey(PageMap.ON_CALL_DUTY_SCHEDULES)]:
        'On-Call Duty Schedules',
    [RouteUtil.getLastPathForKey(PageMap.ON_CALL_DUTY_EXECUTION_LOGS)]:
        'On-Call Duty Logs',
};

const OnCallDutyLayout: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
    const lastPath: string = RouteUtil.getLastPath(path);
    return (
        <Page
            title={PageTitleMap[lastPath]}
            breadcrumbLinks={getOnCallDutyBreadcrumbs(path)}
            sideMenu={<DashboardSideMenu />}
        >
            <Outlet />
        </Page>
    );
};

export default OnCallDutyLayout;
