import Project from 'Model/Models/Project';
import Route from 'Common/Types/API/Route';
import IconProp from 'Common/Types/Icon/IconProp';
import CardModelDetail from 'CommonUI/src/Components/ModelDetail/CardModelDetail';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import DashboardNavigation from '../../Utils/Navigation';
import PageComponentProps from '../PageComponentProps';
import DashboardSideMenu from './SideMenu';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';

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
                    title: 'Settings',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SETTINGS] as Route
                    ),
                },
                {
                    title: 'Call & SMS',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SETTINGS_CALL_SMS] as Route
                    ),
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
            {/* API Key View  */}
            <CardModelDetail
                name="Current Balance"
                cardProps={{
                    title: 'Current Balance',
                    description:
                        'Here is your current call and SMS balance for this project.',
                    icon: IconProp.Billing,
                }}
                isEditable={false}
                modelDetailProps={{
                    modelType: Project,
                    id: 'current-balance',
                    fields: [
                        {
                            field: {
                                smsOrCallCurrentBalanceInUSD: true,
                            },
                            fieldType: FieldType.Number,
                            title: 'SMS or Call Current Balance',
                            description:
                                'This is your current balance for SMS or Call. It is in USD. ',
                            placeholder: '0 USD',
                        },
                    ],
                    modelId: DashboardNavigation.getProjectId()?.toString(),
                }}
            />

            <CardModelDetail
                name="Enable Notifications"
                cardProps={{
                    title: 'Enable Notifications',
                    description:
                        'Enable Call and SMS notifications for this project.',
                    icon: IconProp.Notification,
                }}
                isEditable={true}
                editButtonText="Edit Notification Settings"
                formFields={[
                    {
                        field: {
                            enableCallNotifications: true,
                        },
                        title: 'Enable Call Notifications',
                        description:
                            'Enable Call notifications for this project. This will be used for alerting users by phone call.',
                        fieldType: FormFieldSchemaType.Toggle,
                        required: false,
                    },
                    {
                        field: {
                            enableSmsNotifications: true,
                        },
                        title: 'Enable SMS Notifications',
                        description:
                            'Enable SMS notifications for this project. This will be used for alerting users by sending an SMS.',
                        fieldType: FormFieldSchemaType.Toggle,
                        required: false,
                    },
                ]}
                modelDetailProps={{
                    modelType: Project,
                    id: 'notifications',
                    fields: [
                        {
                            field: {
                                enableCallNotifications: true,
                            },
                            fieldType: FieldType.Boolean,
                            title: 'Enable Call Notifications',
                            placeholder: 'Not Enabled',
                            description:
                                'Enable Call notifications for this project. This will be used for alerting users by phone call.',
                        },
                        {
                            field: {
                                enableSmsNotifications: true,
                            },
                            fieldType: FieldType.Boolean,
                            title: 'Enable SMS Notifications',
                            placeholder: 'Not Enabled',
                            description:
                                'Enable SMS notifications for this project. This will be used for alerting users by SMS.',
                        },
                    ],
                    modelId: DashboardNavigation.getProjectId()?.toString(),
                }}
            />

            <CardModelDetail
                name="Auto Recharge"
                cardProps={{
                    title: 'Auto Recharge',
                    description:
                        'Enable Auto Recharge for call and SMS balance. This will make sure you always have enough balance for sending SMS or making calls.',
                    icon: IconProp.Billing,
                }}
                isEditable={true}
                editButtonText="Edit Auto Recharge"
                formFields={[
                    {
                        field: {
                            enableAutoRechargeSmsOrCallBalance: true,
                        },
                        title: 'Enable Auto Recharge',
                        description:
                            'Enable Auto Recharge. This will be used for sending an SMS or Call.',
                        fieldType: FormFieldSchemaType.Toggle,
                        required: false,
                    },
                    {
                        field: {
                            autoRechargeSmsOrCallByBalanceInUSD: true,
                        },
                        title: 'Auto Recharge Balance by (in USD)',
                        description:
                            'Amount of balance to be recharged when the balance is low. It is in USD. ',
                        fieldType: FormFieldSchemaType.Dropdown,
                        dropdownOptions: [
                            {
                                value: 10,
                                label: '10 USD',
                            },
                            {
                                value: 20,
                                label: '20 USD',
                            },
                            {
                                value: 25,
                                label: '25 USD',
                            },
                            {
                                value: 50,
                                label: '50 USD',
                            },
                            {
                                value: 75,
                                label: '75 USD',
                            },
                            {
                                value: 100,
                                label: '100 USD',
                            },
                            {
                                value: 200,
                                label: '200 USD',
                            },
                            {
                                value: 500,
                                label: '500 USD',
                            },
                            {
                                value: 500,
                                label: '500 USD',
                            },
                            {
                                value: 1000,
                                label: '1000 USD',
                            },
                        ],
                        required: true,
                    },
                    {
                        field: {
                            autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD:
                                true,
                        },
                        title: 'Auto Recharge when balance falls to (in USD)',
                        description:
                            'Trigger auto recharge when balance falls to this amount. It is in USD. ',
                        fieldType: FormFieldSchemaType.Dropdown,
                        dropdownOptions: [
                            {
                                value: 10,
                                label: '10 USD',
                            },
                            {
                                value: 20,
                                label: '20 USD',
                            },
                            {
                                value: 25,
                                label: '25 USD',
                            },
                            {
                                value: 50,
                                label: '50 USD',
                            },
                            {
                                value: 75,
                                label: '75 USD',
                            },
                            {
                                value: 100,
                                label: '100 USD',
                            },
                            {
                                value: 200,
                                label: '200 USD',
                            },
                            {
                                value: 500,
                                label: '500 USD',
                            },
                            {
                                value: 500,
                                label: '500 USD',
                            },
                            {
                                value: 1000,
                                label: '1000 USD',
                            },
                        ],
                        required: true,
                    },
                ]}
                modelDetailProps={{
                    modelType: Project,
                    id: 'notifications',
                    fields: [
                        {
                            field: {
                                enableAutoRechargeSmsOrCallBalance: true,
                            },
                            fieldType: FieldType.Boolean,
                            title: 'Auto Recharge Balance by (in USD)',
                            description:
                                'Amount of balance to be recharged when the balance is low. It is in USD. ',
                            placeholder: 'Not Enabled',
                        },
                        {
                            field: {
                                autoRechargeSmsOrCallByBalanceInUSD: true,
                            },
                            fieldType: FieldType.Text,
                            title: 'Auto Recharge by (in USD)',
                            placeholder: '0 USD',
                        },
                        {
                            field: {
                                autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD:
                                    true,
                            },
                            fieldType: FieldType.Text,
                            title: 'Trigger auto recharge if balance falls below (in USD)',
                            placeholder: '0 USD',
                        },
                    ],
                    modelId: DashboardNavigation.getProjectId()?.toString(),
                }}
            />
        </Page>
    );
};

export default Settings;
