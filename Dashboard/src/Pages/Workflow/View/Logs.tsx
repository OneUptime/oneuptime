import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import WorkflowLogs from 'Model/Models/WorkflowLog';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import DashboardNavigation from '../../../Utils/Navigation';

const Delete: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

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
            <ModelTable<WorkflowLogs>
                modelType={WorkflowLogs}
                id="workflow-logs-table"
                isDeleteable={false}
                isEditable={false}
                isCreateable={false}
                name="Workflow Logs"
                query={{
                    workflowId: modelId,
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                }}
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
                            workflow: {
                                name: true,
                            },
                        },
                        title: 'Workflow Name',
                        type: FieldType.Text,
                        isFilterable: true,
                    },
                    {
                        field: {
                            createdAt: true,
                        },
                        title: 'Logs Created At',
                        type: FieldType.DateTime,
                        isFilterable: true,
                    },
                ]}
            />
        </Page>
    );
};

export default Delete;
