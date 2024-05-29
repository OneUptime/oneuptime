import { getMonitorGroupBreadcrumbs } from '../../../Utils/Breadcrumbs';
import { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import ObjectID from 'Common/Types/ObjectID';
import ModelPage from 'CommonUI/src/Components/Page/ModelPage';
import Navigation from 'CommonUI/src/Utils/Navigation';
import MonitorGroup from 'Model/Models/MonitorGroup';
import React, { FunctionComponent, ReactElement } from 'react';
import { Outlet, useParams } from 'react-router-dom';

const MonitorGroupViewLayout: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const { id } = useParams();
    const modelId: ObjectID = new ObjectID(id || '');
    const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
    return (
        <ModelPage
            title="Monitor Group"
            modelType={MonitorGroup}
            modelId={modelId}
            modelNameField="name"
            breadcrumbLinks={getMonitorGroupBreadcrumbs(path)}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <Outlet />
        </ModelPage>
    );
};

export default MonitorGroupViewLayout;
