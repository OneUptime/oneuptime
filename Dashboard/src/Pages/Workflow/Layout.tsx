import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import WorkflowSideMenu from './SideMenu';
import { Outlet } from 'react-router';
import { getWorkflowsBreadcrumbs } from '../../Utils/Breadcrumbs';
import Navigation from 'CommonUI/src/Utils/Navigation';

const WorkflowsLayout: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
    return (
        <Page
            title={'Workflows'}
            breadcrumbLinks={getWorkflowsBreadcrumbs(path)}
            sideMenu={<WorkflowSideMenu />}
        >
            <Outlet />
        </Page>
    );
};

export default WorkflowsLayout;
