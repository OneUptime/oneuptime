import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import DashboardSideMenu from './SideMenu';
import Card from 'CommonUI/src/Components/Card/Card';
import BasicModelForm from 'CommonUI/src/Components/Forms/BasicModelForm';
import ProjectAPIKey from 'Common/Models/ProjectAPIKey';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import Navigation from 'CommonUI/src/Utils/Navigation';

const APIKeys: FunctionComponent<PageComponentProps> = (
    __props: PageComponentProps
): ReactElement => {
    const model = new ProjectAPIKey();
    return (
        <Page
            title={'Project Settings'}
            breadcrumbLinks={[
                {
                    title: 'Project Name',
                    to: RouteMap[PageMap.HOME] as Route,
                },
                {
                    title: 'Settings',
                    to: RouteMap[PageMap.HOME] as Route,
                },
                {
                    title: 'API Keys',
                    to: RouteMap[PageMap.HOME] as Route,
                },
                {
                    title: 'Create',
                    to: RouteMap[PageMap.HOME] as Route,
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >



            <Card
                title="Add New API Key"
                description="Add new api key here"
            >
                <BasicModelForm<ProjectAPIKey>
                    model={model}
                    id="add-form"
                    fields={[
                        {
                            field: {
                                expires: true,
                            },
                            fieldType: FormFieldSchemaType.Date,
                            placeholder: '12/12/2025',
                            required: false,
                            title: 'Expires At (optional)',
                            description: "If you leave this blank, this API key will never expire. You can still revoke them if needed."
                        },
                    ]}
                    submitButtonText={'Add'}
                    onSubmit={async (_values: any) => {

                    }}
                    onCancel={() => {
                        Navigation.goBack();
                    }}
                />
            </Card>
        </Page>
    );
};

export default APIKeys;
