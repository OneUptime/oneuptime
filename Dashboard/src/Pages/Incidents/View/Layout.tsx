import ModelPage from 'CommonUI/src/Components/Page/ModelPage';
import React, { FunctionComponent, ReactElement } from 'react';
import { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import Incident from 'Model/Models/Incident';
import { Outlet, useParams } from 'react-router-dom';
import { getIncidentsBreadcrumbs } from '../../../Utils/Breadcrumbs/IncidentBreadcrumbs';

const IncidentViewLayout: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const { id } = useParams();
    const modelId: ObjectID = new ObjectID(id || '');
    const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
    return (
        <ModelPage
            title="Incident"
            modelType={Incident}
            modelId={modelId}
            modelNameField="title"
            breadcrumbLinks={getIncidentsBreadcrumbs(path)}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <Outlet />
        </ModelPage>
    );
};

export default IncidentViewLayout;
