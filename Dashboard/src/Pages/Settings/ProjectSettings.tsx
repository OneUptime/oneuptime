import Project from 'Model/Models/Project';
import Route from 'Common/Types/API/Route';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import CardModelDetail from 'CommonUI/src/Components/ModelDetail/CardModelDetail';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap from '../../Utils/RouteMap';

import PageComponentProps from '../PageComponentProps';
import DashboardSideMenu from './SideMenu';

const Settings: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    return (
        <Page
            title={'Project Settings'}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteMap[PageMap.HOME] as Route,
                },
                {
                    title: 'Project Settings',
                    to: RouteMap[PageMap.HOME] as Route,
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
            {/* API Key View  */}
            <CardModelDetail
                cardProps={{
                    title: 'Project Details',
                    description: "Here's more details on this Project.",
                    icon: IconProp.Folder,
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
                                name: true,
                            },
                            title: 'Project Name',
                        },
                    ],
                    modelId: props.currentProject?._id,
                }}
            />
        </Page>
    );
};

export default Settings;
