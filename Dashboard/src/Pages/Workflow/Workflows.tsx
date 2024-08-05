import LabelsElement from "../../Components/Label/Labels";
import DashboardNavigation from "../../Utils/Navigation";
import PageComponentProps from "../PageComponentProps";
import URL from "Common/Types/API/URL";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import OneUptimeDate from "Common/Types/Date";
import WorkflowPlan from "Common/Types/Workflow/WorkflowPlan";
import Banner from "CommonUI/src/Components/Banner/Banner";
import FormFieldSchemaType from "CommonUI/src/Components/Forms/Types/FormFieldSchemaType";
import ModelProgress from "CommonUI/src/Components/ModelProgress/ModelProgress";
import ModelTable from "CommonUI/src/Components/ModelTable/ModelTable";
import FieldType from "CommonUI/src/Components/Types/FieldType";
import Navigation from "CommonUI/src/Utils/Navigation";
import ProjectUtil from "CommonUI/src/Utils/Project";
import Label from "Common/AppModels/Models/Label";
import Workflow from "Common/AppModels/Models/Workflow";
import WorkflowLog from "Common/AppModels/Models/WorkflowLog";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const Workflows: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const startDate: Date = OneUptimeDate.getSomeDaysAgo(30);
  const endDate: Date = OneUptimeDate.getCurrentDate();
  const plan: PlanType | null = ProjectUtil.getCurrentPlan();

  return (
    <Fragment>
      <>
        <Banner
          openInNewTab={true}
          title="Need a demo of workflows?"
          description="Watch this 10 minute video which will help you connect Slack with OneUptime using workflows"
          link={URL.fromString("https://youtu.be/z-b7_KQcUDY")}
        />

        {plan && (plan === PlanType.Growth || plan === PlanType.Scale) && (
          <ModelProgress<WorkflowLog>
            totalCount={WorkflowPlan[plan]}
            modelType={WorkflowLog}
            countQuery={{
              createdAt: new InBetween(startDate, endDate),
            }}
            title="Workflow Runs"
            description={
              "Workflow runs in the last 30 days. Your current plan is " +
              plan +
              ". It currently supports " +
              WorkflowPlan[plan] +
              " runs in the last 30 days."
            }
          />
        )}

        <ModelTable<Workflow>
          modelType={Workflow}
          id="status-page-table"
          isDeleteable={false}
          isEditable={false}
          isCreateable={true}
          name="Workflows"
          isViewable={true}
          showViewIdButton={true}
          cardProps={{
            title: "Workflows",
            description: "Here is a list of workflows for this project.",
          }}
          noItemsMessage={"No workflows found."}
          formSteps={[
            {
              title: "Workflow Info",
              id: "workflow-info",
            },
            {
              title: "Labels",
              id: "labels",
            },
          ]}
          formFields={[
            {
              field: {
                name: true,
              },
              stepId: "workflow-info",
              title: "Name",
              fieldType: FormFieldSchemaType.Text,
              required: true,
              placeholder: "Workflow Name",
              validation: {
                minLength: 2,
              },
            },
            {
              field: {
                description: true,
              },
              stepId: "workflow-info",
              title: "Description",
              fieldType: FormFieldSchemaType.LongText,
              required: true,
              placeholder: "Description",
            },
            {
              field: {
                isEnabled: true,
              },
              stepId: "workflow-info",
              title: "Enabled",
              fieldType: FormFieldSchemaType.Toggle,
            },
            {
              field: {
                labels: true,
              },
              stepId: "labels",
              title: "Labels ",
              description:
                "Team members with access to these labels will only be able to access this resource. This is optional and an advanced feature.",
              fieldType: FormFieldSchemaType.MultiSelectDropdown,
              dropdownModal: {
                type: Label,
                labelField: "name",
                valueField: "_id",
              },
              required: false,
              placeholder: "Labels",
            },
          ]}
          showRefreshButton={true}
          viewPageRoute={Navigation.getCurrentRoute()}
          filters={[
            {
              title: "Name",
              type: FieldType.Text,
              field: {
                name: true,
              },
            },
            {
              title: "Description",
              type: FieldType.Text,
              field: {
                description: true,
              },
            },
            {
              title: "Enabled",
              type: FieldType.Boolean,
              field: {
                isEnabled: true,
              },
            },
            {
              title: "Labels",
              type: FieldType.EntityArray,
              field: {
                labels: {
                  name: true,
                  color: true,
                },
              },
              filterEntityType: Label,
              filterQuery: {
                projectId: DashboardNavigation.getProjectId()?.toString(),
              },
              filterDropdownField: {
                label: "name",
                value: "_id",
              },
              filterDropdownOptions: [],
            },
          ]}
          columns={[
            {
              field: {
                name: true,
              },
              title: "Name",
              type: FieldType.Text,
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              type: FieldType.Text,
            },
            {
              field: {
                isEnabled: true,
              },
              title: "Enabled",
              type: FieldType.Boolean,
            },
            {
              field: {
                labels: {
                  name: true,
                  color: true,
                },
              },
              title: "Labels",
              type: FieldType.EntityArray,
              getElement: (item: Workflow): ReactElement => {
                return <LabelsElement labels={item["labels"] || []} />;
              },
            },
          ]}
        />
      </>
    </Fragment>
  );
};

export default Workflows;
