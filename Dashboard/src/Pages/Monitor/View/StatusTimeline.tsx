import React, {
    Fragment,
    FunctionComponent,
    ReactElement,
    useState,
} from 'react';
import PageComponentProps from '../../PageComponentProps';
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
import DisabledWarning from '../../../Components/Monitor/DisabledWarning';
import { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import Modal, { ModalWidth } from 'CommonUI/src/Components/Modal/Modal';
import ConfirmModal from 'CommonUI/src/Components/Modal/ConfirmModal';
import OneUptimeDate from 'Common/Types/Date';
import { Black } from 'Common/Types/BrandColors';

const StatusTimeline: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    const [showViewLogsModal, setShowViewLogsModal] = useState<boolean>(false);
    const [logs, setLogs] = useState<string>('');

    const [showRootCause, setShowRootCause] = useState<boolean>(false);
    const [rootCause, setRootCause] = useState<string>('');

    return (
        <Fragment>
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
                            item: MonitorStatusTimeline,
                            onCompleteAction: VoidFunction
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
                            item: MonitorStatusTimeline,
                            onCompleteAction: VoidFunction
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
                viewPageRoute={Navigation.getCurrentRoute()}
                filters={[
                    {
                        field: {
                            monitorStatus: {
                                name: true,
                            },
                        },
                        title: 'Monitor Status',
                        type: FieldType.Entity,
                        filterEntityType: MonitorStatus,
                        filterQuery: {
                            projectId:
                                DashboardNavigation.getProjectId()?.toString(),
                        },
                        filterDropdownField: {
                            label: 'name',
                            value: '_id',
                        },
                    },
                    {
                        field: {
                            createdAt: true,
                        },
                        title: 'Starts At',
                        type: FieldType.Date,
                    },
                    {
                        field: {
                            endsAt: true,
                        },
                        title: 'Ends At',
                        type: FieldType.Date,
                    },
                ]}
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
                        getElement: (item: MonitorStatusTimeline): ReactElement => {
                            if (!item['monitorStatus']) {
                                throw new BadDataException(
                                    'Monitor Status not found'
                                );
                            }

                            return (
                                <Statusbubble
                                    color={
                                        item.monitorStatus.color || Black
                                    }
                                    shouldAnimate={false}
                                    text={
                                       item.monitorStatus.name || 'Unknown'
                                    }
                                />
                            );
                        },
                    },
                    {
                        field: {
                            createdAt: true,
                        },
                        title: 'Starts At',
                        type: FieldType.DateTime,
                    },
                    {
                        field: {
                            endsAt: true,
                        },
                        title: 'Ends At',
                        type: FieldType.DateTime,
                        noValueMessage: 'Currently Active',
                    },
                    {
                        field: {
                            endsAt: true,
                        },
                        title: 'Duration',
                        type: FieldType.Text,
                        getElement: (item: MonitorStatusTimeline): ReactElement => {
                            return (
                                <p>
                                    {OneUptimeDate.differenceBetweenTwoDatesAsFromattedString(
                                        item['createdAt'] as Date,
                                        (item['endsAt'] as Date) ||
                                            OneUptimeDate.getCurrentDate()
                                    )}
                                </p>
                            );
                        },
                    },
                ]}
            />
            {showViewLogsModal ? (
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
            ) : (
                <></>
            )}

            {showRootCause ? (
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
            ) : (
                <></>
            )}
        </Fragment>
    );
};

export default StatusTimeline;
