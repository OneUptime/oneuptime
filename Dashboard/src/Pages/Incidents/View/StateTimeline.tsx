import Route from 'Common/Types/API/Route';
import ModelPage from 'CommonUI/src/Components/Page/ModelPage';
import React, { FunctionComponent, ReactElement, useState } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import DashboardNavigation from '../../../Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import IncidentStateTimeline from 'Model/Models/IncidentStateTimeline';
import IconProp from 'Common/Types/Icon/IconProp';
import BadDataException from 'Common/Types/Exception/BadDataException';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import IncidentState from 'Model/Models/IncidentState';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import { JSONObject } from 'Common/Types/JSON';
import Color from 'Common/Types/Color';
import Pill from 'CommonUI/src/Components/Pill/Pill';
import Navigation from 'CommonUI/src/Utils/Navigation';
import Incident from 'Model/Models/Incident';
import { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import Modal, { ModalWidth } from 'CommonUI/src/Components/Modal/Modal';
import ConfirmModal from 'CommonUI/src/Components/Modal/ConfirmModal';

const IncidentViewStateTimeline: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
    const [showViewLogsModal, setShowViewLogsModal] = useState<boolean>(false);
    const [logs, setLogs] = useState<string>('');

    const [showRootCause, setShowRootCause] = useState<boolean>(false);
    const [rootCause, setRootCause] = useState<string>('');


    return (
        <ModelPage
            title="Incident"
            modelType={Incident}
            modelId={modelId}
            modelNameField="title"
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'Incidents',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.INCIDENTS] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'View Incident',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.INCIDENT_VIEW] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'Status Timeline',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.INCIDENT_VIEW_STATE_TIMELINE] as Route,
                        { modelId }
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <ModelTable<IncidentStateTimeline>
                modelType={IncidentStateTimeline}
                id="table-incident-status-timeline"
                name="Monitor > State Timeline"
                isDeleteable={true}
                isCreateable={true}
                isViewable={false}
                showViewIdButton={true}
                query={{
                    incidentId: modelId,
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                }}
                selectMoreFields={{
                    stateChangeLog: true,
                    rootCause: true,
                }}
                actionButtons={[
                    {
                        title: 'View Cause',
                        buttonStyleType: ButtonStyleType.NORMAL,
                        icon: IconProp.TransparentCube,
                        onClick: async (
                            item: JSONObject,
                            onCompleteAction: Function
                        ) => {
                            setRootCause(
                                item['rootCause']
                                    ? item['rootCause'].toString()
                                    : 'No root cause. This monitor status could be created manually.'
                            );
                            setShowRootCause(true);

                            onCompleteAction();
                        },
                    },
                    {
                        title: 'View Logs',
                        buttonStyleType: ButtonStyleType.NORMAL,
                        icon: IconProp.List,
                        onClick: async (
                            item: JSONObject,
                            onCompleteAction: Function
                        ) => {
                            setLogs(
                                item['stateChangeLog']
                                    ? JSON.stringify(
                                        item['stateChangeLog'],
                                        null,
                                        2
                                    )
                                    : 'This incident state was created manually.'
                            );
                            setShowViewLogsModal(true);

                            onCompleteAction();
                        },
                    },
                ]}
                onBeforeCreate={(
                    item: IncidentStateTimeline
                ): Promise<IncidentStateTimeline> => {
                    if (!props.currentProject || !props.currentProject._id) {
                        throw new BadDataException('Project ID cannot be null');
                    }
                    item.incidentId = modelId;
                    item.projectId = new ObjectID(props.currentProject._id);
                    return Promise.resolve(item);
                }}
                cardProps={{
                    icon: IconProp.List,
                    title: 'Status Timeline',
                    description:
                        'Here is the status timeline for this incident',
                }}
                noItemsMessage={
                    'No status timeline created for this incident so far.'
                }
                formFields={[
                    {
                        field: {
                            incidentState: true,
                        },
                        title: 'Incident Status',
                        fieldType: FormFieldSchemaType.Dropdown,
                        required: true,
                        placeholder: 'Incident Status',
                        dropdownModal: {
                            type: IncidentState,
                            labelField: 'name',
                            valueField: '_id',
                        },
                    },
                ]}
                showRefreshButton={true}
                showFilterButton={true}
                viewPageRoute={Navigation.getCurrentRoute()}
                columns={[
                    {
                        field: {
                            incidentState: {
                                name: true,
                                color: true,
                            },
                        },
                        title: 'Incident Status',
                        type: FieldType.Text,
                        isFilterable: true,
                        getElement: (item: JSONObject): ReactElement => {
                            if (!item['incidentState']) {
                                throw new BadDataException(
                                    'Incident Status not found'
                                );
                            }

                            return (
                                <Pill
                                    color={
                                        (item['incidentState'] as JSONObject)[
                                        'color'
                                        ] as Color
                                    }
                                    text={
                                        (item['incidentState'] as JSONObject)[
                                        'name'
                                        ] as string
                                    }
                                />
                            );
                        },
                    },
                    {
                        field: {
                            createdAt: true,
                        },
                        title: 'Reported At',
                        type: FieldType.DateTime,
                    },
                ]}
            />
            {showViewLogsModal && (
                <Modal
                    title={'Why did the status change?'}
                    description="Here is more information about why the status changed for this monitor."
                    isLoading={false}
                    modalWidth={ModalWidth.Large}
                    onSubmit={() => {
                        setShowViewLogsModal(false);
                    }}
                    submitButtonText={'Close'}
                    submitButtonStyleType={ButtonStyleType.NORMAL}
                >
                    <div className="text-gray-500 mt-5 text-sm h-96 overflow-y-auto overflow-x-hidden p-5 border-gray-50 border border-2 bg-gray-100 rounded">
                        {logs.split('\n').map((log: string, i: number) => {
                            return <div key={i}>{log}</div>;
                        })}
                    </div>
                </Modal>
            )}

            {showRootCause && (
                <ConfirmModal
                    title={'Root Cause'}
                    description={rootCause}
                    isLoading={false}
                    onSubmit={() => {
                        setShowRootCause(false);
                    }}
                    submitButtonText={'Close'}
                    submitButtonType={ButtonStyleType.NORMAL}
                />
            )}
        </ModelPage>
    );
};

export default IncidentViewStateTimeline;
