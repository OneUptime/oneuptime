import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import WorkflowVariable from 'Model/Models/WorkflowVariable';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import Navigation from 'CommonUI/src/Utils/Navigation';
import DashboardNavigation from '../../Utils/Navigation';

const Workflows: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    return (
        <Page
            title={'Workflows'}
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
                    title: 'Variables',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.WORKFLOWS_VARIABLES] as Route
                    ),
                },
            ]}
        >
            <ModelTable<WorkflowVariable>
                modelType={WorkflowVariable}
                id="status-page-table"
                isDeleteable={false}
                isEditable={false}
                isCreateable={true}
                name="Workflows"
                isViewable={false}
                cardProps={{
                    icon: IconProp.Variable,
                    title: 'Global Variables',
                    description:
                        'Here is a list of global secrets and variables for this project.',
                }}
                query={{
                    workflowId: null,
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                }}
                noItemsMessage={'No workflows found.'}
                formFields={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Name',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        placeholder: 'Workflow Name',
                        validation: {
                            minLength: 2,
                        },
                    },
                    {
                        field: {
                            description: true,
                        },
                        title: 'Description',
                        fieldType: FormFieldSchemaType.LongText,
                        required: true,
                        placeholder: 'Description',
                    },
                    {
                        field: {
                            isSecret: true,
                        },
                        title: 'Secret',
                        description: "Is this variable secret or secure? Should this be encrypted in the Database?",
                        fieldType: FormFieldSchemaType.Checkbox,
                        required: true,
                    },
                    {
                        field: {
                            content: true,
                        },
                        title: 'Content',
                        description: "Is this variable secret or secure? Should this be encrypted in the Database?",
                        fieldType: FormFieldSchemaType.Checkbox,
                        required: true,
                    },
                ]}
                showRefreshButton={true}
                showFilterButton={true}
                columns={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Name',
                        type: FieldType.Text,
                        isFilterable: true,
                    },
                    {
                        field: {
                            description: true,
                        },
                        title: 'Description',
                        type: FieldType.Text,
                        isFilterable: true,
                    },
                    {
                        field: {
                            createdAt: true,
                        },
                        title: 'Created At',
                        type: FieldType.DateTime,
                        isFilterable: true,
                    },
                ]}
            />
        </Page>
    );
};

export default Workflows;
