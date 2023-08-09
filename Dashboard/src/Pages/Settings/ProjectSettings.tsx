import Project from 'Model/Models/Project';
import Route from 'Common/Types/API/Route';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import CardModelDetail from 'CommonUI/src/Components/ModelDetail/CardModelDetail';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import DashboardNavigation from '../../Utils/Navigation';
import PageComponentProps from '../PageComponentProps';
import DashboardSideMenu from './SideMenu';

const Settings: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    return (
        <Page
            title={'Project Settings'}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route
                    ),
                },
                {
                    title: 'Project Settings',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SETTINGS] as Route
                    ),
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
            {/* Project Settings View  */}
            <CardModelDetail
                name="Project Details"
                cardProps={{
                    title: 'Project Details',
                    description: 'Here are more details for this Project.',
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
                    modelType: Project,
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
                    modelId: DashboardNavigation.getProjectId()?.toString(),
                }}
            />
        </Page>
    );
};

export default Settings;
