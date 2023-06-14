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
import StatusPage from 'Model/Models/StatusPage';
import StatusPageCustomField from 'Model/Models/StatusPageCustomField';
import ProjectUtil from 'CommonUI/src/Utils/Project';

const StatusPageCustomFields: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    return (
        <ModelPage
            title="Status Page"
            modelType={StatusPage}
            modelId={modelId}
            modelNameField="name"
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route,
                        {modelId}
                    ),
                },
                {
                    title: 'Status Pages',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.STATUS_PAGES] as Route,
                        {modelId}
                    ),
                },
                {
                    title: 'View StatusPage',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.STATUS_PAGE_VIEW] as Route,
                        {modelId}
                    ),
                },
                {
                    title: 'Custom Fields',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[
                            PageMap.STATUS_PAGE_VIEW_CUSTOM_FIELDS
                        ] as Route,
                        {modelId}
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <CustomFieldsDetail
                title="Status Page Custom Fields"
                description="Custom fields help you add new fields to your resources in OneUptime."
                modelType={StatusPage}
                customFieldType={StatusPageCustomField}
                name="Status Page Custom Fields"
                projectId={ProjectUtil.getCurrentProject()!.id!}
                modelId={modelId}
            />
        </ModelPage>
    );
};

export default StatusPageCustomFields;
