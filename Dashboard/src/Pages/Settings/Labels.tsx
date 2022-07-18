import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import DashboardSideMenu from './SideMenu';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModalTable';
import Label from 'Common/Models/Label';
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
                    to: RouteMap[PageMap.SETTINGS] as Route,
                },
                {
                    title: 'Labels',
                    to: RouteMap[PageMap.SETTINGS_LABELS] as Route,
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
            <ModelTable<Label>
                type={Label}
                model={new Label()}
                id="labels-table"
                isDeleteable={true}
                isEditable={true}
                isCreateable={true}
                cardProps={{
                    title: 'Labels',
                    description:
                        'Create, edit, delete your project labels here.',
                }}
                columns={[
                    {
                        field: {
                            color: true,
                        },
                        title: 'Name',
                        type: TableColumnType.Text,
                    },
                    {
                        field: {
                            name: true,
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
