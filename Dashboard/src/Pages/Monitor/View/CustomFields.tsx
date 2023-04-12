import Route from 'Common/Types/API/Route';
import ModelPage from 'CommonUI/src/Components/Page/ModelPage';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import CustomFieldsDetail from 'CommonUI/src/Components/CustomFields/CustomFieldsDetail';
import Monitor from 'Model/Models/Monitor';
import MonitorCustomField from 'Model/Models/MonitorCustomField';
import ProjectUtil from 'CommonUI/src/Utils/Project';

const MonitorCustomFields: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    return (
        <ModelPage
            title="Monitor"
            modelType={Monitor}
            modelId={modelId}
            modelNameField="name"
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route,
                        modelId
                    ),
                },
                {
                    title: 'Monitors',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.MONITORS] as Route,
                        modelId
                    ),
                },
                {
                    title: 'View Monitor',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.MONITOR_VIEW] as Route,
                        modelId
                    ),
                },
                {
                    title: 'Custom Fields',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.MONITOR_VIEW_DELETE] as Route,
                        modelId
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <CustomFieldsDetail
                title="Monitor Custom Fields"
                description="Custom fields help you add new fields to your resources in OneUptime."
                modelType={Monitor}
                customFieldType={MonitorCustomField}
                name="Monitor Custom Fields"
                projectId={ProjectUtil.getCurrentProject()!.id!}
                modelId={modelId}
            />
        </ModelPage>
    );
};

export default MonitorCustomFields;
