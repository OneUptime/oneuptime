import Route from 'Common/Types/API/Route';
import ModelPage from 'CommonUI/src/Components/Page/ModelPage';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import WorkflowVariable from 'Model/Models/WorkflowVariable';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import IconProp from 'Common/Types/Icon/IconProp';
import Navigation from 'CommonUI/src/Utils/Navigation';
import DashboardNavigation from '../../../Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import SideMenu from './SideMenu';
import Workflow from 'Model/Models/Workflow';

const Workflows: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    return (
        <ModelPage
            title="Workflow"
            modelType={Workflow}
            modelId={modelId}
            modelNameField="name"
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
                    title: 'View Workflow',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.WORKFLOW_VIEW] as Route,
                        {modelId}
                    ),
                },
                {
                    title: 'Builder',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.WORKFLOW_BUILDER] as Route,
                        {modelId}
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <ModelTable<WorkflowVariable>
                modelType={WorkflowVariable}
                id="status-page-table"
                isDeleteable={true}
                isEditable={false}
                isCreateable={true}
                showViewIdButton={true}
                name="Workflows"
                isViewable={false}
                cardProps={{
                    icon: IconProp.Variable,
                    title: 'Workflow Variables',
                    description:
                        'Here is a list of workflow secrets and variables for this specific workflow.',
                }}
                query={{
                    workflowId: modelId,
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                }}
                onBeforeCreate={(
                    item: WorkflowVariable
                ): Promise<WorkflowVariable> => {
                    item.workflowId = modelId;
                    return Promise.resolve(item);
                }}
                noItemsMessage={'No workflow variables found.'}
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
                            noSpaces: true,
                            noSpecialCharacters: true,
                            noNumbers: true,
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
                        description:
                            'Is this variable secret or secure? Should this be encrypted in the Database?',
                        fieldType: FormFieldSchemaType.Toggle,
                        required: true,
                    },
                    {
                        field: {
                            content: true,
                        },
                        title: 'Content',
                        description: 'Enter the content of the variable',
                        fieldType: FormFieldSchemaType.LongText,
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
                            isSecret: true,
                        },
                        title: 'Secret',
                        type: FieldType.Boolean,
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
        </ModelPage>
    );
};

export default Workflows;
