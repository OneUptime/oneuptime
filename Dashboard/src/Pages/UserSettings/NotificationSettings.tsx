import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import DashboardSideMenu from './SideMenu';
import DashboardNavigation from '../../Utils/Navigation';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import User from 'CommonUI/src/Utils/User';
import UserNotificationSetting from 'Model/Models/UserNotificationSetting';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import NotificationSettingEventType from 'Common/Types/NotificationSetting/NotificationSettingEventType';
import DropdownUtil from 'CommonUI/src/Utils/Dropdown';

const Settings: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const getModelTable: Function = (options: {
        eventOptions: Array<NotificationSettingEventType>;
        title: string;
        description: string;
    }): ReactElement => {
        return (
            <ModelTable<UserNotificationSetting>
                modelType={UserNotificationSetting}
                query={{
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                    userId: User.getUserId().toString(),
                    eventType: options.eventOptions,
                }}
                onBeforeCreate={(
                    model: UserNotificationSetting
                ): UserNotificationSetting => {
                    model.projectId = DashboardNavigation.getProjectId()!;
                    model.userId = User.getUserId();
                    return model;
                }}
                createVerb={'Add'}
                id="notification-settings"
                name={`User Settings > Notification Rules > ${options.title}`}
                isDeleteable={true}
                isEditable={true}
                isCreateable={true}
                cardProps={{
                    title: options.title,
                    description: options.description,
                }}
                noItemsMessage={
                    'No notification settings found. Please add one to receive notifications.'
                }
                formFields={[
                    {
                        field: {
                            eventType: true,
                        },
                        title: 'Event Type',
                        description: 'Select the event type.',
                        fieldType: FormFieldSchemaType.Dropdown,
                        required: true,
                        placeholder: 'Select an event type',
                        dropdownOptions:
                            DropdownUtil.getDropdownOptionsFromArray(
                                options.eventOptions
                            ),
                    },
                    {
                        field: {
                            alertByEmail: true,
                        },
                        title: 'Alert By Email',
                        description:
                            'Select if you want to be alerted by email.',
                        fieldType: FormFieldSchemaType.Toggle,
                        required: false,
                    },
                    {
                        field: {
                            alertBySMS: true,
                        },
                        title: 'Alert By SMS',
                        description: 'Select if you want to be alerted by SMS.',
                        fieldType: FormFieldSchemaType.Toggle,
                        required: false,
                    },
                    {
                        field: {
                            alertByCall: true,
                        },
                        title: 'Alert By Call',
                        description:
                            'Select if you want to be alerted by call.',
                        fieldType: FormFieldSchemaType.Toggle,
                        required: false,
                    },
                ]}
                showRefreshButton={true}
                showFilterButton={false}
                columns={[
                    {
                        field: {
                            eventType: true,
                        },
                        title: 'Event Type',
                        type: FieldType.Text,
                        isFilterable: true,
                    },
                    {
                        field: {
                            alertByEmail: true,
                        },
                        title: 'Email Alerts',
                        type: FieldType.Boolean,
                    },
                    {
                        field: {
                            alertBySMS: true,
                        },
                        title: 'SMS Alerts',
                        type: FieldType.Boolean,
                    },
                    {
                        field: {
                            alertByCall: true,
                        },
                        title: 'Call Alerts',
                        type: FieldType.Boolean,
                    },
                ]}
            />
        );
    };

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
                    title: 'Notification Settings',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[
                            PageMap.USER_SETTINGS_NOTIFICATION_SETTINGS
                        ] as Route
                    ),
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
            <div>
                {getModelTable({
                    eventOptions: [
                        NotificationSettingEventType.SEND_INCIDENT_NOTE_POSTED_OWNER_NOTIFICATION,
                        NotificationSettingEventType.SEND_INCIDENT_OWNER_ADDED_NOTIFICATION,
                        NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION,
                        NotificationSettingEventType.SEND_INCIDENT_STATE_CHANGED_OWNER_NOTIFICATION,
                    ],
                    title: 'Incident Notifications',
                    description:
                        'Here are the list of notification methods we will use when an event happens on an incident.',
                })}
            </div>

            <div>
                {getModelTable({
                    eventOptions: [
                        NotificationSettingEventType.SEND_MONITOR_OWNER_ADDED_NOTIFICATION,
                        NotificationSettingEventType.SEND_MONITOR_CREATED_OWNER_NOTIFICATION,
                        NotificationSettingEventType.SEND_MONITOR_STATUS_CHANGED_OWNER_NOTIFICATION,
                    ],
                    title: 'Monitor Notifications',
                    description:
                        'Here are the list of notification methods we will use when an event happens on a monitor.',
                })}
            </div>

            <div>
                {getModelTable({
                    eventOptions: [
                        NotificationSettingEventType.SEND_STATUS_PAGE_CREATED_OWNER_NOTIFICATION,
                        NotificationSettingEventType.SEND_STATUS_PAGE_OWNER_ADDED_NOTIFICATION,
                        NotificationSettingEventType.SEND_STATUS_PAGE_ANNOUNCEMENT_CREATED_OWNER_NOTIFICATION,
                    ],
                    title: 'Status Page Notifications',
                    description:
                        'Here are the list of notification methods we will use when an event happens on a status page.',
                })}
            </div>

            <div>
                {getModelTable({
                    eventOptions: [
                        NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_NOTE_POSTED_OWNER_NOTIFICATION,
                        NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_OWNER_ADDED_NOTIFICATION,
                        NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_CREATED_OWNER_NOTIFICATION,
                        NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_STATE_CHANGED_OWNER_NOTIFICATION,
                    ],
                    title: 'Scheduled Maintenance Notifications',
                    description:
                        'Here are the list of notification methods we will use when an event happens on an incident.',
                })}
            </div>
        </Page>
    );
};

export default Settings;
