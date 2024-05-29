import WorkflowElement from '../../Components/Workflow/WorkflowElement';
import PageComponentProps from '../PageComponentProps';
import BadDataException from 'Common/Types/Exception/BadDataException';
import IconProp from 'Common/Types/Icon/IconProp';
import WorkflowStatus from 'Common/Types/Workflow/WorkflowStatus';
import { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import Modal, { ModalWidth } from 'CommonUI/src/Components/Modal/Modal';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import SimpleLogViewer from 'CommonUI/src/Components/SimpleLogViewer/SimpleLogViewer';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import WorkflowStatusElement from 'CommonUI/src/Components/Workflow/WorkflowStatus';
import DropdownUtil from 'CommonUI/src/Utils/Dropdown';
import Navigation from 'CommonUI/src/Utils/Navigation';
import WorkflowLog from 'Model/Models/WorkflowLog';
import React, {
    Fragment,
    FunctionComponent,
    ReactElement,
    useState,
} from 'react';

const Workflows: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const [showViewLogsModal, setShowViewLogsModal] = useState<boolean>(false);
    const [logs, setLogs] = useState<string>('');

    return (
        <Fragment>
            <>
                <ModelTable<WorkflowLog>
                    modelType={WorkflowLog}
                    id="workflow-logs-table"
                    isDeleteable={false}
                    actionButtons={[
                        {
                            title: 'View Logs',
                            buttonStyleType: ButtonStyleType.NORMAL,
                            icon: IconProp.List,
                            onClick: async (
                                item: WorkflowLog,
                                onCompleteAction: VoidFunction
                            ) => {
                                setLogs(item['logs'] as string);
                                setShowViewLogsModal(true);

                                onCompleteAction();
                            },
                        },
                    ]}
                    isEditable={false}
                    isCreateable={false}
                    name="Workflow Logs"
                    isViewable={false}
                    selectMoreFields={{
                        logs: true,
                    }}
                    cardProps={{
                        title: 'Workflow Logs',
                        description:
                            'List of logs in the last 30 days for all your workflows',
                    }}
                    noItemsMessage={
                        'Looks like no workflow ran so far in the last 30 days.'
                    }
                    showRefreshButton={true}
                    viewPageRoute={Navigation.getCurrentRoute()}
                    filters={[
                        {
                            field: {
                                workflow: {
                                    name: true,
                                },
                            },
                            title: 'Workflow Name',
                            type: FieldType.Text,
                        },
                        {
                            field: {
                                workflowStatus: true,
                            },
                            title: 'Workflow Status',
                            type: FieldType.Dropdown,
                            filterDropdownOptions:
                                DropdownUtil.getDropdownOptionsFromEnum(
                                    WorkflowStatus
                                ),
                        },
                        {
                            field: {
                                createdAt: true,
                            },
                            title: 'Scheduled At',
                            type: FieldType.Date,
                        },
                        {
                            field: {
                                startedAt: true,
                            },
                            title: 'Started At',
                            type: FieldType.Date,
                        },
                        {
                            field: {
                                completedAt: true,
                            },
                            title: 'Completed At',
                            type: FieldType.Date,
                        },
                    ]}
                    columns={[
                        {
                            field: {
                                workflow: {
                                    name: true,
                                },
                            },
                            title: 'Workflow Name',
                            type: FieldType.Text,

                            getElement: (item: WorkflowLog): ReactElement => {
                                return (
                                    <WorkflowElement
                                        workflow={item.workflow!}
                                    />
                                );
                            },
                        },
                        {
                            field: {
                                workflowStatus: true,
                            },

                            title: 'Workflow Status',
                            type: FieldType.Text,
                            getElement: (item: WorkflowLog): ReactElement => {
                                if (!item['workflowStatus']) {
                                    throw new BadDataException(
                                        'Workflow Status not found'
                                    );
                                }

                                return (
                                    <WorkflowStatusElement
                                        status={
                                            item[
                                                'workflowStatus'
                                            ] as WorkflowStatus
                                        }
                                    />
                                );
                            },
                        },
                        {
                            field: {
                                createdAt: true,
                            },
                            title: 'Scheduled At',
                            type: FieldType.DateTime,
                        },
                        {
                            field: {
                                startedAt: true,
                            },
                            title: 'Started At',
                            type: FieldType.DateTime,
                        },
                        {
                            field: {
                                completedAt: true,
                            },
                            title: 'Completed At',
                            type: FieldType.DateTime,
                        },
                    ]}
                />

                {showViewLogsModal && (
                    <Modal
                        title={'Workflow Logs'}
                        description="Here are the logs for this workflow"
                        isLoading={false}
                        modalWidth={ModalWidth.Large}
                        onSubmit={() => {
                            setShowViewLogsModal(false);
                        }}
                        submitButtonText={'Close'}
                        submitButtonStyleType={ButtonStyleType.NORMAL}
                    >
                        <SimpleLogViewer>
                            {logs.split('\n').map((log: string, i: number) => {
                                return <div key={i}>{log}</div>;
                            })}
                        </SimpleLogViewer>
                    </Modal>
                )}
            </>
        </Fragment>
    );
};

export default Workflows;
