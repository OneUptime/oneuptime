import Project from 'Model/Models/Project';
import Route from 'Common/Types/API/Route';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import CardModelDetail from 'CommonUI/src/Components/ModelDetail/CardModelDetail';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import DashboardNavigation from '../../Utils/Navigation';
import DashboardSideMenu from '../SideMenu';

const Settings: FunctionComponent = (
    
): ReactElement => {
    return (
        <Page
            title={'Admin Settings'}
            breadcrumbLinks={[
                {
                    title: 'Admin Dashboard',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route
                    ),
                },
                {
                    title: 'Settings',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SETTINGS] as Route
                    ),
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
            {/* Project Settings View  */}
            <CardModelDetail
                name="Host Settings"
                cardProps={{
                    title: 'Host Settings',
                    description: 'Host settings for this OneUptime Server Instance',
                }}
                isEditable={true}
                formFields={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Project Name',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        placeholder: 'Project Name',
                        validation: {
                            minLength: 2,
                        },
                    },
                ]}
                modelDetailProps={{
                    modelType: GlobalConfig,
                    id: 'model-detail-project',
                    fields: [
                        {
                            field: {
                                _id: true,
                            },
                            title: 'Project ID',
                        },
                        {
                            field: {
                                name: true,
                            },
                            title: 'Project Name',
                        },
                    ],
                    modelId: DashboardNavigation.getProjectId()!,
                }}
            />
        </Page>
    );
};

export default Settings;
