import DashboardNavigation from "../../Utils/Navigation";
import PageComponentProps from "../PageComponentProps";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import WorkflowVariable from "Common/Models/DatabaseModels/WorkflowVariable";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import IsNull from "Common/Types/BaseDatabase/IsNull";

const Workflows: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<WorkflowVariable>
        modelType={WorkflowVariable}
        id="status-page-table"
        isDeleteable={true}
        isEditable={false}
        isCreateable={true}
        name="Workflows"
        isViewable={false}
        cardProps={{
          title: "Global Variables",
          description:
            "Here is a list of global secrets and variables for this project.",
        }}
        query={{
          workflowId: new IsNull(),
          projectId: DashboardNavigation.getProjectId()!,
        }}
        noItemsMessage={"No global variables found."}
        showViewIdButton={true}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Workflow Name",
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
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: true,
            placeholder: "Description",
          },
          {
            field: {
              isSecret: true,
            },
            title: "Secret",
            description:
              "Is this variable secret or secure? Should this be encrypted in the Database?",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
          {
            field: {
              content: true,
            },
            title: "Content",
            description: "Enter the content of the variable",
            fieldType: FormFieldSchemaType.LongText,
            required: true,
          },
        ]}
        showRefreshButton={true}
        filters={[
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
              isSecret: true,
            },
            title: "Secret",
            type: FieldType.Boolean,
          },
          {
            field: {
              createdAt: true,
            },
            title: "Created At",
            type: FieldType.Date,
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
              isSecret: true,
            },
            title: "Secret",
            type: FieldType.Boolean,
          },
          {
            field: {
              createdAt: true,
            },
            title: "Created At",
            type: FieldType.DateTime,
          },
        ]}
      />
    </Fragment>
  );
};

export default Workflows;
