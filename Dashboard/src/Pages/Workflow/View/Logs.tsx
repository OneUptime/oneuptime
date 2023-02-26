import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement, useState } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import IconProp from 'Common/Types/Icon/IconProp';
import WorkflowLogs from 'Model/Models/WorkflowLog';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import DashboardNavigation from '../../../Utils/Navigation';
import { JSONObject } from 'Common/Types/JSON';
import { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import Modal, { ModalWidth } from 'CommonUI/src/Components/Modal/Modal';
import BadDataException from 'Common/Types/Exception/BadDataException';
import WorkflowStatus from 'Common/Types/Workflow/WorkflowStatus';
import WorkflowStatusElement from 'CommonUI/src/Components/Workflow/WorkflowStatus';

const Delete: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    const [showViewLogsModal, setShowViewLogsModal] = useState<boolean>(false);
    const [logs, setLogs] = useState<string>('');

    return (
        <Page
            title={'Workflow'}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route,
                        modelId
                    ),
                },
                {
                    title: 'Workflows',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.WORKFLOWS] as Route,
                        modelId
                    ),
                },
                {
                    title: 'View Workflow',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.WORKFLOW_VIEW] as Route,
                        modelId
                    ),
                },
                {
                    title: 'Logs',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.WORKFLOW_LOGS] as Route,
                        modelId
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <>
                <ModelTable<WorkflowLogs>
                    modelType={WorkflowLogs}
                    id="workflow-logs-table"
                    isDeleteable={false}
                    isEditable={false}
                    isCreateable={false}
                    name="Workflow Logs"
                    query={{
                        workflowId: modelId,
                        projectId:
                            DashboardNavigation.getProjectId()?.toString(),
                    }}
                    selectMoreFields={{
                        logs: true,
                    }}
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
                    isViewable={false}
                    cardProps={{
                        icon: IconProp.Logs,
                        title: 'Workflow Logs',
                        description:
                            'List of logs in the last 30 days for this workflow',
                    }}
                    noItemsMessage={
                        'Looks like this workflow did not run so far in the last 30 days.'
                    }
                    showRefreshButton={true}
                    showFilterButton={true}
                    viewPageRoute={Navigation.getCurrentRoute()}
                    columns={[
                        {
                            field: {
                                _id: true,
                            },
                            title: 'Run ID',
                            type: FieldType.Text,
                            isFilterable: true,
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
        </Page>
    );
};

export default Delete;
