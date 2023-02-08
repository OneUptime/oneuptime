import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement, useState } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import WorkflowLogs from 'Model/Models/WorkflowLog';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import IconProp from 'Common/Types/Icon/IconProp';
import Navigation from 'CommonUI/src/Utils/Navigation';
import WorkflowSideMenu from './SideMenu';
import { JSONObject } from 'Common/Types/JSON';
import Workflow from 'Model/Models/Workflow';
import WorkflowElement from '../../Components/Workflow/WorkflowElement';
import JSONFunctions from 'Common/Types/JSONFunctions';
import { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import Modal, { ModalWidth } from 'CommonUI/src/Components/Modal/Modal';

const Workflows: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const [showViewLogsModal, setShowViewLogsModal] = useState<boolean>(false);
    const [logs, setLogs] = useState<string>('');

    return (
        <Page
            title={'Workflow Logs'}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route
                    ),
                },
                {
                    title: 'Workflows',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.WORKFLOWS] as Route
                    ),
                },
                {
                    title: 'Logs',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.WORKFLOWS_LOGS] as Route
                    ),
                },
            ]}
            sideMenu={<WorkflowSideMenu />}
        >
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
                        icon: IconProp.Logs,
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
                                            JSONFunctions.fromJSON(
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
                                createdAt: true,
                            },
                            title: 'Workflow Ran At',
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
                        <div className="text-gray-500 mt-5 text-sm h-96 overflow-scroll overflow-x-hidden p-5 border-gray-50 border border-2 bg-gray-100 rounded">
                            {logs}
                        </div>
                    </Modal>
                )}
            </>
        </Page>
    );
};

export default Workflows;
