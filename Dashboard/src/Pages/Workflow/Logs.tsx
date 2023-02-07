import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import WorkflowLogs from 'Model/Models/WorkflowLog';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import Navigation from 'CommonUI/src/Utils/Navigation';
import WorkflowSideMenu from './SideMenu';

const Workflows: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
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
            <ModelTable<WorkflowLogs>
                modelType={WorkflowLogs}
                id="workflow-logs-table"
                isDeleteable={false}
                isEditable={false}
                isCreateable={false}
                name="Workflow Logs"
                isViewable={false}
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

export default Workflows;
