import Route from 'Common/Types/API/Route';
import React, { FunctionComponent, ReactElement, useState } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import DashboardNavigation from '../../../Utils/Navigation';
import IconProp from 'Common/Types/Icon/IconProp';
import Navigation from 'CommonUI/src/Utils/Navigation';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import { JSONObject } from 'Common/Types/JSON';
import Pill from 'CommonUI/src/Components/Pill/Pill';
import { Green, Red, Yellow } from 'Common/Types/BrandColors';
import { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import ConfirmModal from 'CommonUI/src/Components/Modal/ConfirmModal';
import ObjectID from 'Common/Types/ObjectID';
import ModelPage from 'CommonUI/src/Components/Page/ModelPage';
import OnCallDutyPolicy from 'Model/Models/OnCallDutyPolicy';
import RouteParams from '../../../Utils/RouteParams';
import SideMenu from './SideMenu';
import OnCallDutyPolicyExecutionLogTimeline from 'Model/Models/OnCallDutyPolicyExecutionLogTimeline';
import OnCallDutyExecutionLogTimelineStatus from 'Common/Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus';
import UserElement from '../../../Components/User/User';
import User from 'Model/Models/User';
import JSONFunctions from 'Common/Types/JSONFunctions';
import EscalationRule from '../../../Components/OnCallPolicy/EscalationRule/EscalationRule';
import OnCallDutyPolicyEscalationRule from 'Model/Models/OnCallDutyPolicyEscalationRule';

const Settings: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const onCallDutyPolicyId: string | null = Navigation.getParamByName(
        RouteParams.ModelID,
        RouteMap[PageMap.ON_CALL_DUTY_POLICY_VIEW_EXECUTION_LOG_VIEW]!
    );
    const modelId: ObjectID = Navigation.getLastParamAsObjectID();

    const [showViewStatusMessageModal, setShowViewStatusMessageModal] =
        useState<boolean>(false);
    const [statusMessage, setStatusMessage] = useState<string>('');

    const getModelTable: Function = (): ReactElement => {
        return (
            <ModelTable<OnCallDutyPolicyExecutionLogTimeline>
                modelType={OnCallDutyPolicyExecutionLogTimeline}
                query={{
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                    onCallDutyPolicyExecutionLogId: modelId.toString(),
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
                        type: FieldType.Date,
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
                        type: FieldType.Date,
                        isFilterable: true,
                        noValueMessage: 'Not Acknowledged',
                    },
                    {
                        field: {
                            status: true,
                        },
                        title: 'Status',
                        type: FieldType.Element,
                        isFilterable: true,
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
                                OnCallDutyExecutionLogTimelineStatus.Running
                            ) {
                                return (
                                    <Pill
                                        color={Yellow}
                                        text={
                                            OnCallDutyExecutionLogTimelineStatus.Running
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
        <ModelPage
            title="On Call Policy"
            modelType={OnCallDutyPolicy}
            modelId={onCallDutyPolicyId}
            modelNameField="name"
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'On Call Duty',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.ON_CALL_DUTY] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'View On Call Policy',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.ON_CALL_DUTY_POLICY_VIEW] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'Logs',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[
                            PageMap.ON_CALL_DUTY_POLICY_VIEW_EXECUTION_LOGS
                        ] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'Timeline',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[
                            PageMap.ON_CALL_DUTY_POLICY_VIEW_EXECUTION_LOG_VIEW
                        ] as Route,
                        {
                            modelId: new ObjectID(onCallDutyPolicyId as string),
                            subModelId: modelId,
                        }
                    ),
                },
            ]}
            sideMenu={
                <SideMenu
                    modelId={new ObjectID(onCallDutyPolicyId as string)}
                />
            }
        >
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
        </ModelPage>
    );
};

export default Settings;
