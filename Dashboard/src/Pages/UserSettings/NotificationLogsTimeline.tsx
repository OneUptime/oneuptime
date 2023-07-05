import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import DashboardSideMenu from './SideMenu';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import UserNotificationLog from 'Model/Models/UserNotificationLog';
import DashboardNavigation from '../../Utils/Navigation';
import User from 'CommonUI/src/Utils/User';
import IconProp from 'Common/Types/Icon/IconProp';
import Navigation from 'CommonUI/src/Utils/Navigation';
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
                    title: 'Notification Logs',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[
                            PageMap.USER_SETTINGS_NOTIFICATION_LOGS
                        ] as Route
                    ),
                },
                {
                    title: 'Timeline',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[
                            PageMap.USER_SETTINGS_NOTIFICATION_LOGS
                        ] as Route
                    ),
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
            <ModelTable<UserNotificationLog>
                modelType={UserNotificationLog}
                query={{
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                    userId: User.getUserId()?.toString(),
                }}
                id="notification-logs-table"
                name="User Settings > Notification Logs"
                isDeleteable={false}
                isEditable={false}
                isCreateable={false}
                cardProps={{
                    icon: IconProp.Logs,
                    title: 'Notification Logs',
                    description:
                        'Here are all the notification logs. This will help you to debug any notification issues that you may face.',
                }}
                noItemsMessage={'No notifications sent out so far.'}
                viewPageRoute={Navigation.getCurrentRoute()}
                showRefreshButton={true}
                showFilterButton={true}
                showViewIdButton={true}
                columns={[
                    {
                        field: {
                            onCallDutyPolicy: {
                                name: true,
                            },
                        },
                        title: 'On Call Policy',
                        type: FieldType.Text,
                        isFilterable: true,

                        getElement: (item: JSONObject): ReactElement => {
                            return (
                                <Pill
                                    color={item['color'] as Color}
                                    text={item['name'] as string}
                                />
                            );
                        },
                    },
                    {
                        field: {
                            onCallDutyPolicyEscalationRule: {
                                name: true,
                            },
                        },
                        title: 'Escalation Rule',
                        type: FieldType.Text,
                        isFilterable: true,
                    },
                    {
                        field: {
                            createdAt: true,
                        },
                        title: 'Created At',
                        type: FieldType.Date,
                        isFilterable: true,
                    },
                    {
                        field: {
                            status: true,
                        },
                        title: 'Status',
                        type: FieldType.Text,
                        isFilterable: true,
                    },
                ]}
            />
        </Page>
    );
};

export default Settings;
