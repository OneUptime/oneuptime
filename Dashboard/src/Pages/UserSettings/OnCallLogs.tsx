import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement, useState } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import DashboardSideMenu from './SideMenu';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import UserOnCallLog from 'Model/Models/UserOnCallLog';
import DashboardNavigation from '../../Utils/Navigation';
import User from 'CommonUI/src/Utils/User';
import IconProp from 'Common/Types/Icon/IconProp';
import Navigation from 'CommonUI/src/Utils/Navigation';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import { JSONObject } from 'Common/Types/JSON';
import OnCallDutyPolicy from 'Model/Models/OnCallDutyPolicy';
import OnCallDutyPolicyView from '../../Components/OnCallPolicy/OnCallPolicy';
import OnCallDutyPolicyEscalationRule from 'Model/Models/OnCallDutyPolicyEscalationRule';
import EscalationRuleView from '../../Components/OnCallPolicy/EscalationRule/EscalationRule';
import Pill from 'CommonUI/src/Components/Pill/Pill';
import UserNotificationExecutionStatus from 'Common/Types/UserNotification/UserNotificationExecutionStatus';
import { Green, Red, Yellow } from 'Common/Types/BrandColors';
import { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import ConfirmModal from 'CommonUI/src/Components/Modal/ConfirmModal';
import DropdownUtil from 'CommonUI/src/Utils/Dropdown';

const Settings: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const [showViewStatusMessageModal, setShowViewStatusMessageModal] =
        useState<boolean>(false);
    const [statusMessage, setStatusMessage] = useState<string>('');

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
                            PageMap.USER_SETTINGS_ON_CALL_LOGS
                        ] as Route
                    ),
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
            <ModelTable<UserOnCallLog>
                modelType={UserOnCallLog}
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
                selectMoreFields={{
                    statusMessage: true,
                }}
                noItemsMessage={'No notifications sent out so far.'}
                viewPageRoute={Navigation.getCurrentRoute()}
                showRefreshButton={true}
                showFilterButton={true}
                showViewIdButton={true}
                isViewable={true}
                actionButtons={[
                    {
                        title: 'View Status Message',
                        buttonStyleType: ButtonStyleType.NORMAL,
                        onClick: async (
                            item: JSONObject,
                            onCompleteAction: Function,
                            onError: (err: Error) => void
                        ) => {
                            try {
                                setStatusMessage(
                                    item['statusMessage'] as string
                                );
                                setShowViewStatusMessageModal(true);

                                onCompleteAction();
                            } catch (err) {
                                onCompleteAction();
                                onError(err as Error);
                            }
                        },
                    },
                ]}
                viewButtonText={'View Timeline'}
                columns={[
                    {
                        field: {
                            onCallDutyPolicy: {
                                name: true,
                            },
                        },
                        title: 'On Call Policy',
                        type: FieldType.Element,
                        isFilterable: true,
                        filterEntityType: OnCallDutyPolicy,
                        filterQuery: {
                            projectId:
                                DashboardNavigation.getProjectId()?.toString(),
                        },
                        filterDropdownField: {
                            label: 'name',
                            value: '_id',
                        },
                        getElement: (item: JSONObject): ReactElement => {
                            if (item['onCallDutyPolicy']) {
                                return (
                                    <OnCallDutyPolicyView
                                        onCallPolicy={
                                            item[
                                                'onCallDutyPolicy'
                                            ] as OnCallDutyPolicy
                                        }
                                    />
                                );
                            }
                            return <p>No on-call policy.</p>;
                        },
                    },
                    {
                        field: {
                            onCallDutyPolicyEscalationRule: {
                                name: true,
                            },
                        },
                        title: 'Escalation Rule',
                        type: FieldType.Element,
                        isFilterable: true,
                        filterEntityType: OnCallDutyPolicyEscalationRule,
                        filterQuery: {
                            projectId:
                                DashboardNavigation.getProjectId()?.toString(),
                        },
                        filterDropdownField: {
                            label: 'name',
                            value: '_id',
                        },
                        getElement: (item: JSONObject): ReactElement => {
                            if (item['onCallDutyPolicyEscalationRule']) {
                                return (
                                    <EscalationRuleView
                                        escalationRule={
                                            item[
                                                'onCallDutyPolicyEscalationRule'
                                            ] as OnCallDutyPolicyEscalationRule
                                        }
                                    />
                                );
                            }
                            return <p>No escalation rule.</p>;
                        },
                    },
                    {
                        field: {
                            createdAt: true,
                        },
                        title: 'Created At',
                        type: FieldType.DateTime,
                        isFilterable: true,
                    },
                    {
                        field: {
                            status: true,
                        },
                        title: 'Status',
                        type: FieldType.Element,
                        isFilterable: true,
                        filterDropdownOptions:
                            DropdownUtil.getDropdownOptionsFromEnum(
                                UserNotificationExecutionStatus
                            ),
                        getElement: (item: JSONObject): ReactElement => {
                            if (
                                item['status'] ===
                                UserNotificationExecutionStatus.Completed
                            ) {
                                return (
                                    <Pill
                                        color={Green}
                                        text={
                                            UserNotificationExecutionStatus.Completed
                                        }
                                    />
                                );
                            } else if (
                                item['status'] ===
                                UserNotificationExecutionStatus.Started
                            ) {
                                return (
                                    <Pill
                                        color={Yellow}
                                        text={
                                            UserNotificationExecutionStatus.Started
                                        }
                                    />
                                );
                            } else if (
                                item['status'] ===
                                UserNotificationExecutionStatus.Scheduled
                            ) {
                                return (
                                    <Pill
                                        color={Yellow}
                                        text={
                                            UserNotificationExecutionStatus.Scheduled
                                        }
                                    />
                                );
                            } else if (
                                item['status'] ===
                                UserNotificationExecutionStatus.Executing
                            ) {
                                return (
                                    <Pill
                                        color={Yellow}
                                        text={
                                            UserNotificationExecutionStatus.Executing
                                        }
                                    />
                                );
                            }

                            return (
                                <Pill
                                    color={Red}
                                    text={UserNotificationExecutionStatus.Error}
                                />
                            );
                        },
                    },
                ]}
            />

            {showViewStatusMessageModal ? (
                <ConfirmModal
                    title={'Status Message'}
                    description={statusMessage}
                    submitButtonText={'Close'}
                    onSubmit={async () => {
                        setShowViewStatusMessageModal(false);
                    }}
                />
            ) : (
                <></>
            )}
        </Page>
    );
};

export default Settings;
