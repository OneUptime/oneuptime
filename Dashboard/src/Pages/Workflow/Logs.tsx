import React, {
    Fragment,
    FunctionComponent,
    ReactElement,
    useState,
} from 'react';
import BaseModel from 'Common/Models/BaseModel';
import PageComponentProps from '../PageComponentProps';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import WorkflowLogs from 'Model/Models/WorkflowLog';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import IconProp from 'Common/Types/Icon/IconProp';
import Navigation from 'CommonUI/src/Utils/Navigation';
import { JSONObject } from 'Common/Types/JSON';
import Workflow from 'Model/Models/Workflow';
import WorkflowElement from '../../Components/Workflow/WorkflowElement';
import { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import Modal, { ModalWidth } from 'CommonUI/src/Components/Modal/Modal';
import BadDataException from 'Common/Types/Exception/BadDataException';
import WorkflowStatus from 'Common/Types/Workflow/WorkflowStatus';
import WorkflowStatusElement from 'CommonUI/src/Components/Workflow/WorkflowStatus';

const Workflows: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const [showViewLogsModal, setShowViewLogsModal] = useState<boolean>(false);
    const [logs, setLogs] = useState<string>('');

    return (
        <Fragment>
            <>
                <ModelTable<WorkflowLogs>
                    modelType={WorkflowLogs}
                    id="workflow-logs-table"
                    isDeleteable={false}
                    actionButtons={[
                        {
                            title: 'View Logs',
                            buttonStyleType: ButtonStyleType.NORMAL,
                            icon: IconProp.List,
                            onClick: async (
                                item: JSONObject,
                                onCompleteAction: Function
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
                    showFilterButton={true}
                    viewPageRoute={Navigation.getCurrentRoute()}
                    columns={[
                        {
                            field: {
                                workflow: {
                                    name: true,
                                },
                            },
                            title: 'Workflow Name',
                            type: FieldType.Text,
                            isFilterable: true,
                            getElement: (item: JSONObject): ReactElement => {
                                return (
                                    <WorkflowElement
                                        workflow={
                                            BaseModel.fromJSON(
                                                (item[
                                                    'workflow'
                                                ] as JSONObject) || [],
                                                Workflow
                                            ) as Workflow
                                        }
                                    />
                                );
                            },
                        },
                        {
                            field: {
                                workflowStatus: true,
                            },
                            isFilterable: true,

                            title: 'Workflow Status',
                            type: FieldType.Text,
                            getElement: (item: JSONObject): ReactElement => {
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
                            isFilterable: true,
                        },
                        {
                            field: {
                                startedAt: true,
                            },
                            title: 'Started At',
                            type: FieldType.DateTime,
                            isFilterable: true,
                        },
                        {
                            field: {
                                completedAt: true,
                            },
                            title: 'Completed At',
                            type: FieldType.DateTime,
                            isFilterable: true,
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
                        <div className="text-gray-500 mt-5 text-sm h-96 overflow-y-auto overflow-x-hidden p-5 border-gray-50 border border-2 bg-gray-100 rounded">
                            {logs.split('\n').map((log: string, i: number) => {
                                return <div key={i}>{log}</div>;
                            })}
                        </div>
                    </Modal>
                )}
            </>
        </Fragment>
    );
};

export default Workflows;
