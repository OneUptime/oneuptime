
import React, { FunctionComponent, ReactElement, useState } from 'react';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import OnCallDutyPolicyExecutionLog from 'Model/Models/OnCallDutyPolicyExecutionLog';
import DashboardNavigation from '../../../Utils/Navigation';
import IconProp from 'Common/Types/Icon/IconProp';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import { JSONObject } from 'Common/Types/JSON';
import Pill from 'CommonUI/src/Components/Pill/Pill';
import { Green, Red, Yellow } from 'Common/Types/BrandColors';
import { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import ConfirmModal from 'CommonUI/src/Components/Modal/ConfirmModal';
import IncidentView from '../../../Components/Incident/Incident';
import Incident from 'Model/Models/Incident';
import OnCallDutyPolicyStatus from 'Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus';
import UserElement from '../../../Components/User/User';
import JSONFunctions from 'Common/Types/JSONFunctions';
import User from 'Model/Models/User';
import DropdownUtil from 'CommonUI/src/Utils/Dropdown';
import ObjectID from 'Common/Types/ObjectID';
import Query from 'CommonUI/src/Utils/ModelAPI/Query';
import Columns from 'CommonUI/src/Components/ModelTable/Columns';
import OnCallPolicyView from '../OnCallPolicy';
import OnCallDutyPolicy from 'Model/Models/OnCallDutyPolicy';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageMap from '../../../Utils/PageMap';

export interface ComponentProps {
    onCallDutyPolicyId?: ObjectID | undefined; // if this is undefined. then it'll show logs for all policies.
}

const ExecutionLogsTable: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {


    const [showViewStatusMessageModal, setShowViewStatusMessageModal] =
        useState<boolean>(false);
    const [statusMessage, setStatusMessage] = useState<string>('');

    const query: Query<OnCallDutyPolicyExecutionLog> = {
        projectId: DashboardNavigation.getProjectId()?.toString(),
    }

    if (props.onCallDutyPolicyId) {
        query.onCallDutyPolicyId = props.onCallDutyPolicyId.toString();
    }


    let columns: Columns<OnCallDutyPolicyExecutionLog> = [];

    if (props.onCallDutyPolicyId) {
        // add a column for the policy name
        columns = columns.concat([
            {
                field: {
                    onCallDutyPolicy: {
                        name: true,
                    },
                },
                title: 'Policy Name',
                type: FieldType.Element,
                isFilterable: true,
                getElement: (item: JSONObject): ReactElement => {
                    if (item['onCallDutyPolicy']) {
                        return (
                            <OnCallPolicyView onCallPolicy={item['onCallDutyPolicy'] as OnCallDutyPolicy} />
                        );
                    }
                    return <p>No on call policy.</p>;
                },
            },
        ]);
    }

    columns = columns.concat([
        {
            field: {
                triggeredByIncident: {
                    title: true,
                },
            },
            title: 'Triggered By Incident',
            type: FieldType.Element,
            isFilterable: false,
            getElement: (item: JSONObject): ReactElement => {
                if (item['triggeredByIncident']) {
                    return (
                        <IncidentView
                            incident={
                                item[
                                'triggeredByIncident'
                                ] as Incident
                            }
                        />
                    );
                }
                return <p>No incident.</p>;
            },
        },
        {
            field: {
                createdAt: true,
            },
            title: 'Triggered at',
            type: FieldType.Date,
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
                    OnCallDutyPolicyStatus
                ),
            getElement: (item: JSONObject): ReactElement => {
                if (
                    item['status'] ===
                    OnCallDutyPolicyStatus.Completed
                ) {
                    return (
                        <Pill
                            color={Green}
                            text={OnCallDutyPolicyStatus.Completed}
                        />
                    );
                } else if (
                    item['status'] ===
                    OnCallDutyPolicyStatus.Started
                ) {
                    return (
                        <Pill
                            color={Yellow}
                            text={OnCallDutyPolicyStatus.Started}
                        />
                    );
                } else if (
                    item['status'] ===
                    OnCallDutyPolicyStatus.Scheduled
                ) {
                    return (
                        <Pill
                            color={Yellow}
                            text={OnCallDutyPolicyStatus.Scheduled}
                        />
                    );
                } else if (
                    item['status'] ===
                    OnCallDutyPolicyStatus.Running
                ) {
                    return (
                        <Pill
                            color={Yellow}
                            text={OnCallDutyPolicyStatus.Running}
                        />
                    );
                }

                return (
                    <Pill
                        color={Red}
                        text={OnCallDutyPolicyStatus.Error}
                    />
                );
            },
        },
        {
            field: {
                acknowledgedByUser: {
                    name: true,
                    email: true,
                },
            },
            title: 'Acknowledged By',
            type: FieldType.Element,
            isFilterable: false,
            getElement: (item: JSONObject): ReactElement => {
                if (item['acknowledgedByUser']) {
                    return (
                        <UserElement
                            user={
                                JSONFunctions.fromJSON(
                                    item[
                                    'acknowledgedByUser'
                                    ] as JSONObject,
                                    User
                                ) as User
                            }
                        />
                    );
                }

                return <p>Not acknowledged</p>;
            },
        },
    ]);

    return (
        <>
            <ModelTable<OnCallDutyPolicyExecutionLog>
                modelType={OnCallDutyPolicyExecutionLog}
                query={query}
                id="execution-logs-table"
                name="On Call Policy > Logs"
                isDeleteable={false}
                isEditable={false}
                isCreateable={false}
                isViewable={true}
                cardProps={{
                    icon: IconProp.Logs,
                    title: 'On Call Policy Logs',
                    description:
                        'Here are all the notification logs. This will help you to debug any notification issues that your team may face.',
                }}
                selectMoreFields={{
                    statusMessage: true,
                    onCallDutyPolicyId: true
                }}
                noItemsMessage={'This policy has not executed so far.'}
                onViewPage={(item: OnCallDutyPolicyExecutionLog)=> {
                    return RouteUtil.populateRouteParams(RouteMap[PageMap.ON_CALL_DUTY_POLICY_VIEW_EXECUTION_LOG_VIEW]!, {
                        modelId: item.onCallDutyPolicyId!,
                        subModelId: item.id!
                    })
                }}
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
                viewButtonText={'View Timeline'}
                columns={columns}
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

        </>
    );
};

export default ExecutionLogsTable;
