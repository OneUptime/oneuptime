import { getOnCallDutyBreadcrumbs } from '../../../Utils/Breadcrumbs';
import { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import ObjectID from 'Common/Types/ObjectID';
import ModelPage from 'CommonUI/src/Components/Page/ModelPage';
import Navigation from 'CommonUI/src/Utils/Navigation';
import OnCallDutySchedule from 'Model/Models/OnCallDutyPolicySchedule';
import React, { FunctionComponent, ReactElement } from 'react';
import { Outlet, useParams } from 'react-router-dom';

const OnCallDutyScheduleViewLayout: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const { id } = useParams();
    const modelId: ObjectID = new ObjectID(id || '');
    const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

    return (
        <ModelPage
            title="On-Call Schedule"
            modelType={OnCallDutySchedule}
            modelId={modelId}
            modelNameField="name"
            breadcrumbLinks={getOnCallDutyBreadcrumbs(path)}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <Outlet />
        </ModelPage>
    );
};

export default OnCallDutyScheduleViewLayout;
