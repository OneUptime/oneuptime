import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import DashboardSideMenu from './SideMenu';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import Button, { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModalTable';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ProjectAPIKey from 'Common/Models/ProjectAPIKey';
import TableColumnType from 'CommonUI/src/Components/Table/Types/TableColumnType';

const APIKeys: FunctionComponent<PageComponentProps> = (
    __props: PageComponentProps
): ReactElement => {
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
            <ModelTable<ProjectAPIKey>
                model={new ProjectAPIKey()}
                cardProps={{
                    title: 'Manage API Keys',
                    description:
                        'Create, edit, delete your project API Keys here.',
                    headerButtons: [
                        <Button
                            key={1}
                            title="Create API Key"
                            buttonStyle={ButtonStyleType.OUTLINE}
                            onClick={() => {
                                Navigation.navigate(
                                    RouteMap[
                                        PageMap.SETTINGS_CREATE_APIKEY
                                    ] as Route
                                );
                            }}
                            icon={IconProp.Add}
                        />,
                    ],
                }}
                columns={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'API Key Name',
                        type: TableColumnType.Text,
                    },
                    {
                        field: {
                            expires: true,
                        },
                        title: 'Expires',
                        type: TableColumnType.Date,
                    },
                    {
                        title: 'Actions',
                        type: TableColumnType.Actions,
                    },
                ]}
            />
        </Page>
    );
};

export default APIKeys;
