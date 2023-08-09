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
import MonitorStatusTimeline from 'Model/Models/MonitorStatusTimeline';
import IconProp from 'Common/Types/Icon/IconProp';
import BadDataException from 'Common/Types/Exception/BadDataException';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import MonitorStatus from 'Model/Models/MonitorStatus';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import { JSONObject } from 'Common/Types/JSON';
import Statusbubble from 'CommonUI/src/Components/StatusBubble/StatusBubble';
import Color from 'Common/Types/Color';
import Navigation from 'CommonUI/src/Utils/Navigation';
import Monitor from 'Model/Models/Monitor';
import DisabledWarning from '../../../Components/Monitor/DisabledWarning';
import { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import Modal, { ModalWidth } from 'CommonUI/src/Components/Modal/Modal';
import ConfirmModal from 'CommonUI/src/Components/Modal/ConfirmModal';

const StatusTimeline: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    const [showViewLogsModal, setShowViewLogsModal] = useState<boolean>(false);
    const [logs, setLogs] = useState<string>('');

    const [showRootCause, setShowRootCause] = useState<boolean>(false);
    const [rootCause, setRootCause] = useState<string>('');

    return (
        <ModelPage
            title="Monitor"
            modelType={Monitor}
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
                    title: 'Monitors',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.MONITORS] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'View Monitor',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.MONITOR_VIEW] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'Status Timeline',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.MONITOR_VIEW_STATUS_TIMELINE] as Route,
                        { modelId }
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <DisabledWarning monitorId={modelId} />
            <ModelTable<MonitorStatusTimeline>
                modelType={MonitorStatusTimeline}
                id="table-monitor-status-timeline"
                name="Monitor > Status Timeline"
                isDeleteable={true}
                showViewIdButton={true}
                isCreateable={true}
                isViewable={false}
                selectMoreFields={{
                    statusChangeLog: true,
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
                                item['statusChangeLog']
                                    ? JSON.stringify(
                                          item['statusChangeLog'],
                                          null,
                                          2
                                      )
                                    : 'No logs for this status event.'
                            );
                            setShowViewLogsModal(true);

                            onCompleteAction();
                        },
                    },
                ]}
                query={{
                    monitorId: modelId,
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                }}
                onBeforeCreate={(
                    item: MonitorStatusTimeline
                ): Promise<MonitorStatusTimeline> => {
                    if (!props.currentProject || !props.currentProject._id) {
                        throw new BadDataException('Project ID cannot be null');
                    }
                    item.monitorId = modelId;
                    item.projectId = new ObjectID(props.currentProject._id);
                    return Promise.resolve(item);
                }}
                cardProps={{
                    title: 'Status Timeline',
                    description: 'Here is the status timeline for this monitor',
                }}
                noItemsMessage={
                    'No status timeline created for this monitor so far.'
                }
                formFields={[
                    {
                        field: {
                            monitorStatus: true,
                        },
                        title: 'Monitor Status',
                        fieldType: FormFieldSchemaType.Dropdown,
                        required: true,
                        placeholder: 'Monitor Status',
                        dropdownModal: {
                            type: MonitorStatus,
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
                            monitorStatus: {
                                name: true,
                                color: true,
                            },
                        },
                        title: 'Monitor Status',
                        type: FieldType.Text,
                        isFilterable: true,
                        getElement: (item: JSONObject): ReactElement => {
                            if (!item['monitorStatus']) {
                                throw new BadDataException(
                                    'Monitor Status not found'
                                );
                            }

                            return (
                                <Statusbubble
                                    color={
                                        (item['monitorStatus'] as JSONObject)[
                                            'color'
                                        ] as Color
                                    }
                                    text={
                                        (item['monitorStatus'] as JSONObject)[
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

export default StatusTimeline;
