import React, {
    Fragment,
    FunctionComponent,
    ReactElement,
    useState,
} from 'react';
import PageComponentProps from '../PageComponentProps';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import UserOnCallLog from 'Model/Models/UserOnCallLog';
import DashboardNavigation from '../../Utils/Navigation';
import User from 'CommonUI/src/Utils/User';
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
import { ErrorFunction, VoidFunction } from 'Common/Types/FunctionTypes';

const Settings: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const [showViewStatusMessageModal, setShowViewStatusMessageModal] =
        useState<boolean>(false);
    const [statusMessage, setStatusMessage] = useState<string>('');

    return (
        <Fragment>
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
                showViewIdButton={true}
                isViewable={true}
                actionButtons={[
                    {
                        title: 'View Status Message',
                        buttonStyleType: ButtonStyleType.NORMAL,
                        onClick: async (
                            item: JSONObject,
                            onCompleteAction: VoidFunction,
                            onError: ErrorFunction
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
                filters={[
                    {
                        field: {
                            onCallDutyPolicy: {
                                name: true,
                            },
                        },
                        filterEntityType: OnCallDutyPolicy,
                        filterQuery: {
                            projectId:
                                DashboardNavigation.getProjectId()?.toString(),
                        },
                        filterDropdownField: {
                            label: 'name',
                            value: '_id',
                        },
                        title: 'On-Call Policy',
                        type: FieldType.Entity,
                    },
                    {
                        field: {
                            onCallDutyPolicyEscalationRule: {
                                name: true,
                            },
                        },
                        filterEntityType: OnCallDutyPolicyEscalationRule,
                        filterQuery: {
                            projectId:
                                DashboardNavigation.getProjectId()?.toString(),
                        },
                        filterDropdownField: {
                            label: 'name',
                            value: '_id',
                        },
                        title: 'Escalation Rule',
                        type: FieldType.Entity,
                    },
                    {
                        field: {
                            status: true,
                        },
                        title: 'Status',
                        type: FieldType.Dropdown,
                        filterDropdownOptions:
                            DropdownUtil.getDropdownOptionsFromEnum(
                                UserNotificationExecutionStatus
                            ),
                    },
                    {
                        field: {
                            createdAt: true,
                        },
                        title: 'Created At',
                        type: FieldType.DateTime,
                    },
                ]}
                columns={[
                    {
                        field: {
                            onCallDutyPolicy: {
                                name: true,
                            },
                        },
                        title: 'On-Call Policy',
                        type: FieldType.Element,

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
                    },
                    {
                        field: {
                            status: true,
                        },
                        title: 'Status',
                        type: FieldType.Element,

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
        </Fragment>
    );
};

export default Settings;
