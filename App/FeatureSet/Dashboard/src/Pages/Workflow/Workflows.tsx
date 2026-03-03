import LabelsElement from "Common/UI/Components/Label/Labels";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import URL from "Common/Types/API/URL";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import OneUptimeDate from "Common/Types/Date";
import WorkflowPlan from "Common/Types/Workflow/WorkflowPlan";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelProgress from "Common/UI/Components/ModelProgress/ModelProgress";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Label from "Common/Models/DatabaseModels/Label";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import WorkflowLog from "Common/Models/DatabaseModels/WorkflowLog";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green500, Red500 } from "Common/Types/BrandColors";
import WorkflowElement from "../../Components/Workflow/WorkflowElement";

const Workflows: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const startDate: Date = OneUptimeDate.getSomeDaysAgo(30);
  const endDate: Date = OneUptimeDate.getCurrentDate();
  const plan: PlanType | null = ProjectUtil.getCurrentPlan();

  return (
    <Fragment>
      <>
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
          userPreferencesKey="workflow-table"
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
          videoLink={URL.fromString("https://youtu.be/z-b7_KQcUDY")}
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
                projectId: ProjectUtil.getCurrentProjectId()!,
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
              type: FieldType.Element,
              getElement: (item: Workflow): ReactElement => {
                return <WorkflowElement workflow={item} />;
              },
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              type: FieldType.LongText,
              hideOnMobile: true,
            },
            {
              field: {
                isEnabled: true,
              },
              title: "Enabled",
              type: FieldType.Element,
              getElement: (item: Workflow): ReactElement => {
                if (item.isEnabled) {
                  return (
                    <Pill text="Enabled" color={Green500} isMinimal={true} />
                  );
                }
                return <Pill text="Disabled" color={Red500} isMinimal={true} />;
              },
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
              hideOnMobile: true,
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
