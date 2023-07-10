import React, { FunctionComponent, ReactElement, useState } from 'react';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import DashboardNavigation from '../../../Utils/Navigation';
import IconProp from 'Common/Types/Icon/IconProp';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import { JSONObject } from 'Common/Types/JSON';
import Pill from 'CommonUI/src/Components/Pill/Pill';
import { Green, Red, Yellow } from 'Common/Types/BrandColors';
import { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import ConfirmModal from 'CommonUI/src/Components/Modal/ConfirmModal';
import OnCallDutyPolicyExecutionLogTimeline from 'Model/Models/OnCallDutyPolicyExecutionLogTimeline';
import OnCallDutyExecutionLogTimelineStatus from 'Common/Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus';
import UserElement from '../../User/User';
import User from 'Model/Models/User';
import JSONFunctions from 'Common/Types/JSONFunctions';
import EscalationRule from '../EscalationRule/EscalationRule';
import OnCallDutyPolicyEscalationRule from 'Model/Models/OnCallDutyPolicyEscalationRule';
import ObjectID from 'Common/Types/ObjectID';
import DropdownUtil from 'CommonUI/src/Utils/Dropdown';

export interface ComponentProps {
    onCallPolicyExecutionLogId: ObjectID;
}

const ExecutionLogTimelineTable: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [showViewStatusMessageModal, setShowViewStatusMessageModal] =
        useState<boolean>(false);
    const [statusMessage, setStatusMessage] = useState<string>('');

    const getModelTable: Function = (): ReactElement => {
        return (
            <ModelTable<OnCallDutyPolicyExecutionLogTimeline>
                modelType={OnCallDutyPolicyExecutionLogTimeline}
                query={{
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                    onCallDutyPolicyExecutionLogId:
                        props.onCallPolicyExecutionLogId.toString(),
                }}
                id="notification-logs-timeline-table"
                name="On Call > Execution Logs > Timeline"
                isDeleteable={false}
                isEditable={false}
                isCreateable={false}
                cardProps={{
                    icon: IconProp.Logs,
                    title: 'Policy Execution Timeline',
                    description:
                        'You can view the timeline of the execution of the policy here. You can also view the status of the notification sent out to the users.',
                }}
                selectMoreFields={{
                    statusMessage: true,
                }}
                noItemsMessage={'No notifications sent out so far.'}
                showRefreshButton={true}
                showFilterButton={true}
                showViewIdButton={true}
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
                columns={[
                    {
                        field: {
                            onCallDutyPolicyEscalationRule: {
                                name: true,
                                onCallDutyPolicyId: true,
                            },
                        },
                        title: 'Escalation Rule',
                        type: FieldType.Element,
                        getElement: (item: JSONObject): ReactElement => {
                            if (
                                item &&
                                item['onCallDutyPolicyEscalationRule']
                            ) {
                                return (
                                    <EscalationRule
                                        escalationRule={
                                            item[
                                                'onCallDutyPolicyEscalationRule'
                                            ] as OnCallDutyPolicyEscalationRule
                                        }
                                    />
                                );
                            }
                            return <p>No escalation rule found.</p>;
                        },
                    },
                    {
                        field: {
                            createdAt: true,
                        },
                        title: 'Started At',
                        type: FieldType.DateTime,
                        isFilterable: true,
                    },
                    {
                        field: {
                            alertSentToUser: {
                                name: true,
                                email: true,
                            },
                        },
                        title: 'Notification Sent To',
                        type: FieldType.Element,
                        getElement: (item: JSONObject): ReactElement => {
                            if (item['alertSentToUser']) {
                                return (
                                    <UserElement
                                        user={
                                            JSONFunctions.fromJSON(
                                                item[
                                                    'alertSentToUser'
                                                ] as JSONObject,
                                                User
                                            ) as User
                                        }
                                    />
                                );
                            }

                            return <p>Invalid User</p>;
                        },
                    },
                    {
                        field: {
                            acknowledgedAt: true,
                        },
                        title: 'Acknowledged At',
                        type: FieldType.DateTime,
                        isFilterable: true,
                        noValueMessage: '-',
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
                                OnCallDutyExecutionLogTimelineStatus
                            ),
                        getElement: (item: JSONObject): ReactElement => {
                            if (
                                item['status'] ===
                                OnCallDutyExecutionLogTimelineStatus.NotificationSent
                            ) {
                                return (
                                    <Pill
                                        color={Green}
                                        text={
                                            OnCallDutyExecutionLogTimelineStatus.NotificationSent
                                        }
                                    />
                                );
                            } else if (
                                item['status'] ===
                                OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged
                            ) {
                                return (
                                    <Pill
                                        color={Green}
                                        text={
                                            OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged
                                        }
                                    />
                                );
                            } else if (
                                item['status'] ===
                                OnCallDutyExecutionLogTimelineStatus.Error
                            ) {
                                return (
                                    <Pill
                                        color={Yellow}
                                        text={
                                            OnCallDutyExecutionLogTimelineStatus.Error
                                        }
                                    />
                                );
                            } else if (
                                item['status'] ===
                                OnCallDutyExecutionLogTimelineStatus.Skipped
                            ) {
                                return (
                                    <Pill
                                        color={Yellow}
                                        text={
                                            OnCallDutyExecutionLogTimelineStatus.Skipped
                                        }
                                    />
                                );
                            } else if (
                                item['status'] ===
                                OnCallDutyExecutionLogTimelineStatus.Executing
                            ) {
                                return (
                                    <Pill
                                        color={Yellow}
                                        text={
                                            OnCallDutyExecutionLogTimelineStatus.Executing
                                        }
                                    />
                                );
                            } else if (
                                item['status'] ===
                                OnCallDutyExecutionLogTimelineStatus.Started
                            ) {
                                return (
                                    <Pill
                                        color={Yellow}
                                        text={
                                            OnCallDutyExecutionLogTimelineStatus.Started
                                        }
                                    />
                                );
                            }

                            return (
                                <Pill
                                    color={Red}
                                    text={
                                        OnCallDutyExecutionLogTimelineStatus.Error
                                    }
                                />
                            );
                        },
                    },
                ]}
            />
        );
    };

    return (
        <>
            {getModelTable()}

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
        </>
    );
};

export default ExecutionLogTimelineTable;
