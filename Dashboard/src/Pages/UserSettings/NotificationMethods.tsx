import UserEmail from 'Model/Models/UserEmail';
import Route from 'Common/Types/API/Route';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import IconProp from 'Common/Types/Icon/IconProp';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import DashboardNavigation from '../../Utils/Navigation';
import PageComponentProps from '../PageComponentProps';
import DashboardSideMenu from './SideMenu';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import User from 'CommonUI/src/Utils/User';
import FieldType from 'CommonUI/src/Components/Types/FieldType';

const Settings: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    return (
        <Page
            title={'User Settings'}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route
                    ),
                },
                {
                    title: 'User Settings',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.USER_SETTINGS] as Route
                    ),
                },
                {
                    title: 'Notification Methods',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.USER_SETTINGS_NOTIFICATION_METHODS] as Route
                    ),
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
            

            <ModelTable<UserEmail>
                modelType={UserEmail}
                query={{
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                    userId: User.getUserId().toString()
                }}
                id="user-emails"
                name="User Settings > Notifiation Methods > Emails"
                isDeleteable={true}
                isEditable={false}
                isCreateable={true}
                cardProps={{
                    icon: IconProp.Email,
                    title: 'Emails for Notifications',
                    description:
                        'Manage emails that will receive notifications for this project.',
                }}
                noItemsMessage={'No emails found. Please add one to receive notifications.'}
                formFields={[
                    {
                        field: {
                            email: true,
                        },
                        title: 'Email',
                        fieldType: FormFieldSchemaType.Email,
                        required: true,
                        placeholder: 'you@company.com',
                        validation: {
                            minLength: 2,
                        },
                    }
                ]}
                showRefreshButton={true}
                showFilterButton={false}
                columns={[
                    {
                        field: {
                            email: true,
                        },
                        title: 'Email',
                        type: FieldType.Email,
                        isFilterable: false,
                    },
                    {
                        field: {
                            isVerified: true,
                        },
                        title: 'Verified',
                        type: FieldType.Boolean,
                    },
                ]}
            />

        </Page>
    );
};

export default Settings;
