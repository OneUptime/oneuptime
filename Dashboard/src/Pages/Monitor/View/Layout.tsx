import React, { FunctionComponent, ReactElement } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import Navigation from 'CommonUI/src/Utils/Navigation';
import { getMonitorBreadcrumbs } from '../../../Utils/Breadcrumbs';
import { RouteUtil } from '../../../Utils/RouteMap';
import ModelPage from 'CommonUI/src/Components/Page/ModelPage';
import SideMenu from './SideMenu';
import ObjectID from 'Common/Types/ObjectID';
import Monitor from 'Model/Models/Monitor';

const MonitorViewLayout: FunctionComponent = (): ReactElement => {
    const { id } = useParams();
    const modelId: ObjectID = new ObjectID(id || '');
    const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
    return (
        <ModelPage
            title="Monitor"
            modelType={Monitor}
            modelId={modelId}
            modelNameField="name"
            breadcrumbLinks={getMonitorBreadcrumbs(path)}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <Outlet />
        </ModelPage>
    );
};

export default MonitorViewLayout;
