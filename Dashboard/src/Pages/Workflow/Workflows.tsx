import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import Workflow from 'Model/Models/Workflow';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import IconProp from 'Common/Types/Icon/IconProp';
import Navigation from 'CommonUI/src/Utils/Navigation';
import WorkflowSideMenu from './SideMenu';
import Label from 'Model/Models/Label';
import DashboardNavigation from '../../Utils/Navigation';
import { JSONArray, JSONObject } from 'Common/Types/JSON';
import LabelsElement from '../../Components/Label/Labels';
import JSONFunctions from 'Common/Types/JSONFunctions';
import ProjectUtil from 'CommonUI/src/Utils/Project';
import { PlanSelect } from 'Common/Types/Billing/SubscriptionPlan';
import ModelProgress from "CommonUI/src/Components/ModelProgress/ModelProgress";
import WorkflowLog from 'Model/Models/WorkflowLog';
import WorkflowPlan from 'Common/Types/Workflow/WorkflowPlan';
import OneUptimeDate from 'Common/Types/Date';
import InBetween from 'Common/Types/Database/InBetween';

const Workflows: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const startDate: Date = OneUptimeDate.getSomeDaysAgo(30);
    const endDate: Date = OneUptimeDate.getCurrentDate();
    const plan = ProjectUtil.getCurrentPlan();

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
            ]}
            sideMenu={<WorkflowSideMenu />}
        >
            <>

                {plan && (plan === PlanSelect.Growth || plan === PlanSelect.Scale) && <ModelProgress<WorkflowLog> 
                    totalCount={WorkflowPlan[plan]}
                    modelType={WorkflowLog}
                    countQuery={
                        {
                            createdAt: new InBetween(startDate, endDate)
                        }
                    }
                    title="Workflow Runs"
                    description={"Workflow runs in the last 30 days. Your current plan is "+plan+". It currently supports "+WorkflowPlan[plan]+" runs in the last 30 days."}
                />}


                <ModelTable<Workflow>
                    modelType={Workflow}
                    id="status-page-table"
                    isDeleteable={false}
                    isEditable={true}
                    isCreateable={true}
                    name="Workflows"
                    isViewable={true}
                    cardProps={{
                        icon: IconProp.CheckCircle,
                        title: 'Workflows',
                        description:
                            'Here is a list of workflows for this project.',
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
                                isEnabled: true,
                            },
                            title: 'Enabled',
                            fieldType: FormFieldSchemaType.Checkbox,
                        },
                    ]}
                    showRefreshButton={true}
                    showFilterButton={true}
                    viewPageRoute={Navigation.getCurrentRoute().addRoute(
                        new Route('/workflow')
                    )}
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
                                isEnabled: true,
                            },
                            title: 'Enabled',
                            type: FieldType.Boolean,
                            isFilterable: true,
                        },
                        {
                            field: {
                                labels: {
                                    name: true,
                                    color: true,
                                },
                            },
                            title: 'Labels',
                            type: FieldType.EntityArray,
                            isFilterable: true,
                            filterEntityType: Label,
                            filterQuery: {
                                projectId:
                                    DashboardNavigation.getProjectId()?.toString(),
                            },
                            filterDropdownField: {
                                label: 'name',
                                value: '_id',
                            },
                            getElement: (item: JSONObject): ReactElement => {
                                return (
                                    <LabelsElement
                                        labels={
                                            JSONFunctions.fromJSON(
                                                (item['labels'] as JSONArray) || [],
                                                Label
                                            ) as Array<Label>
                                        }
                                    />
                                );
                            },
                        },
                    ]}
                />
            </>
        </Page>
    );
};

export default Workflows;
