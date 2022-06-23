import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement, useState } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import DashboardSideMenu from './SideMenu';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import Button, { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import TableCard from 'CommonUI/src/Components/Table/TableCard';
import Card from 'CommonUI/src/Components/Card/Card';
import BasicModelForm from 'CommonUI/src/Components/Forms/BasicModelForm';
import ProjectAPIKey from 'Common/Models/ProjectAPIKey';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';

const APIKeys: FunctionComponent<PageComponentProps> = (
    __props: PageComponentProps
): ReactElement => {
    const [showAddForm, setShowAddForm] = useState<boolean>(false);

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
            ]}
            sideMenu={<DashboardSideMenu />}
        >
            {!showAddForm ? (
                <TableCard
                    title="Manage API Keys"
                    description="Create, edit, delete your project API Keys here."
                    headerButtons={[
                        <Button
                            key={1}
                            title="Create API Key"
                            buttonStyle={ButtonStyleType.SECONDRY}
                            onClick={() => {
                                setShowAddForm(true);
                            }}
                            icon={IconProp.Add}
                        />,
                    ]}
                />
            ) : (
                <></>
            )}

            {showAddForm ? (
                <Card
                    title="Add New API Key"
                    description="Add new api key here"
                >
                    <BasicModelForm<ProjectAPIKey>
                        model={new ProjectAPIKey()}
                        id="add-form"
                        fields={[
                            {
                                field: {
                                    expires: true,
                                },
                                fieldType: FormFieldSchemaType.Date,
                                placeholder: '12/12/2025',
                                required: false,
                                title: 'Expires',
                            },
                        ]}
                        submitButtonText={'Add'}
                        onSubmit={async (values: any) => {
                            
                        }}
                    />
                </Card>
            ) : (
                <></>
            )}
        </Page>
    );
};

export default APIKeys;
