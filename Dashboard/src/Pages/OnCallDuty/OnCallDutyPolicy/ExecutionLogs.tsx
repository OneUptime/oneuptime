import Route from 'Common/Types/API/Route';
import React, { FunctionComponent, ReactElement, useState } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import OnCallDutyPolicyExecutionLog from 'Model/Models/OnCallDutyPolicyExecutionLog';
import DashboardNavigation from '../../../Utils/Navigation';
import IconProp from 'Common/Types/Icon/IconProp';
import Navigation from 'CommonUI/src/Utils/Navigation';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import { JSONObject } from 'Common/Types/JSON';
import OnCallDutyPolicy from 'Model/Models/OnCallDutyPolicy';
import Pill from 'CommonUI/src/Components/Pill/Pill';
import { Green, Red, Yellow } from 'Common/Types/BrandColors';
import { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import ConfirmModal from 'CommonUI/src/Components/Modal/ConfirmModal';
import ModelPage from 'CommonUI/src/Components/Page/ModelPage';
import ObjectID from 'Common/Types/ObjectID';
import SideMenu from './SideMenu';
import IncidentView from '../../../Components/Incident/Incident';
import Incident from 'Model/Models/Incident';
import OnCallDutyPolicyStatus from 'Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus';
import UserElement from '../../../Components/User/User';
import JSONFunctions from 'Common/Types/JSONFunctions';
import User from 'Model/Models/User';

const Settings: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID();
    const [showViewStatusMessageModal, setShowViewStatusMessageModal] =
        useState<boolean>(false);
    const [statusMessage, setStatusMessage] = useState<string>('');

    return (
        <ModelPage
            title="On Call Policy"
            modelType={OnCallDutyPolicy}
            modelId={modelId}
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
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <ModelTable<OnCallDutyPolicyExecutionLog>
                modelType={OnCallDutyPolicyExecutionLog}
                query={{
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                    onCallPolicyId: modelId.toString(),
                }}
                id="execution-logs-table"
                name="On Call Policy > Logs"
                isDeleteable={false}
                isEditable={false}
                isCreateable={false}
                cardProps={{
                    icon: IconProp.Logs,
                    title: 'On Call Policy Logs',
                    description:
                        'Here are all the notification logs. This will help you to debug any notification issues that your team may face.',
                }}
                selectMoreFields={{
                    statusMessage: true,
                }}
                noItemsMessage={'This policy has not executed so far.'}
                viewPageRoute={Navigation.getCurrentRoute()}
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
                columns={[
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
                            acknowledgedBy: {
                                name: true,
                                email: true,
                            },
                        },
                        title: 'Acknowledged By',
                        type: FieldType.Element,
                        getElement: (item: JSONObject): ReactElement => {
                            if (item['acknowledgedBy']) {
                                return (
                                    <UserElement
                                        user={
                                            JSONFunctions.fromJSON(
                                                item[
                                                    'acknowledgedBy'
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
        </ModelPage>
    );
};

export default Settings;
