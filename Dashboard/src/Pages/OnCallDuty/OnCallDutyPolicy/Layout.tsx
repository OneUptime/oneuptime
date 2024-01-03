import ModelPage from 'CommonUI/src/Components/Page/ModelPage';
import React, { FunctionComponent, ReactElement } from 'react';
import { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import ObjectID from 'Common/Types/ObjectID';
import OnCallDutyPolicy from 'Model/Models/OnCallDutyPolicy';
import { Outlet, useParams } from 'react-router';
import { getOnCallDutyBreadcrumbs } from '../../../Utils/Breadcrumbs';
import Navigation from 'CommonUI/src/Utils/Navigation';

const OnCallDutyPolicyViewLayout: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const { id } = useParams();
    const modelId: ObjectID = new ObjectID(id || '');
    const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
    return (
        <ModelPage
            title="On-Call Policy"
            modelType={OnCallDutyPolicy}
            modelId={modelId}
            modelNameField="name"
            breadcrumbLinks={getOnCallDutyBreadcrumbs(path)}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <Outlet />
        </ModelPage>
    );
};

export default OnCallDutyPolicyViewLayout;
