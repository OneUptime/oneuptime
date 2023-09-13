import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import Navigation from 'CommonUI/src/Utils/Navigation';
import User from 'Model/Models/User';

const Users: FunctionComponent = (): ReactElement => {
    return (
        <Page
            title={'Users'}
            breadcrumbLinks={[
                {
                    title: 'Admin Dashboard',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route
                    ),
                },
                {
                    title: 'Users',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.USERS] as Route
                    ),
                },
            ]}
        >
            <ModelTable<User>
                modelType={User}
                id="users-table"
                isDeleteable={false}
                isEditable={false}
                showViewIdButton={true}
                isCreateable={true}
                name="Users"
                isViewable={false}
                cardProps={{
                    title: 'Users',
                    description: 'Here is a list of users in OneUptime.',
                }}
                noItemsMessage={'No users found.'}
                formFields={[
                    {
                        field: {
                            email: true,
                        },
                        title: 'Email',
                        fieldType: FormFieldSchemaType.Email,
                        required: true,
                        placeholder: 'email@company.com',
                    },
                    {
                        field: {
                            password: true,
                        },
                        title: 'Password',
                        fieldType: FormFieldSchemaType.Password,
                        required: true,
                        placeholder: 'Password',
                    },
                    {
                        field: {
                            name: true,
                        },
                        title: 'Full Name',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        placeholder: 'John Smith',
                    },
                ]}
                showRefreshButton={true}
                showFilterButton={true}
                viewPageRoute={Navigation.getCurrentRoute()}
                columns={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Full Name',
                        type: FieldType.Text,
                        isFilterable: true,
                    },
                    {
                        field: {
                            email: true,
                        },
                        title: 'Email',
                        type: FieldType.Email,
                        isFilterable: true,
                    },
                    {
                        field: {
                            createdAt: true,
                        },
                        title: 'Created At',
                        type: FieldType.DateTime,
                        isFilterable: true,
                    },
                ]}
            />
        </Page>
    );
};

export default Users;
