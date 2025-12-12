import LabelsElement from "Common/UI/Components/Label/Labels";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import Navigation from "Common/UI/Utils/Navigation";
import Label from "Common/Models/DatabaseModels/Label";
import CodeRepository from "Common/Models/DatabaseModels/CodeRepository";
import React, { FunctionComponent, ReactElement } from "react";

const CodeRepositoryPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <ModelTable<CodeRepository>
      modelType={CodeRepository}
      id="code-repository-table"
      userPreferencesKey="code-repository-table"
      isDeleteable={false}
      isEditable={false}
      isCreateable={true}
      name="Code Repositories"
      isViewable={true}
      cardProps={{
        title: "Code Repositories",
        description:
          "Connect and manage your GitHub and GitLab repositories here.",
      }}
      showViewIdButton={true}
      noItemsMessage={"No repositories connected."}
      formFields={[
        {
          field: {
            name: true,
          },
          title: "Name",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "Repository Name",
          validation: {
            minLength: 2,
          },
        },
        {
          field: {
            description: true,
          },
          title: "Description",
          fieldType: FormFieldSchemaType.LongText,
          required: false,
          placeholder: "Description",
        },
        {
          field: {
            repositoryHostedAt: true,
          },
          title: "Repository Host",
          description: "Where is this repository hosted?",
          fieldType: FormFieldSchemaType.Dropdown,
          required: true,
          placeholder: "Select Host",
          dropdownOptions:
            DropdownUtil.getDropdownOptionsFromEnum(CodeRepositoryType),
        },
        {
          field: {
            organizationName: true,
          },
          title: "Organization / Username",
          description: "The GitHub organization or username that owns the repository.",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "Organization Name",
        },
        {
          field: {
            repositoryName: true,
          },
          title: "Repository Name",
          description: "The name of the repository.",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "Repository Name",
        },
        {
          field: {
            mainBranchName: true,
          },
          title: "Main Branch",
          description: "The main branch of the repository (e.g., main, master).",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "main",
        },
      ]}
      showRefreshButton={true}
      viewPageRoute={Navigation.getCurrentRoute()}
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
            repositoryHostedAt: true,
          },
          title: "Repository Host",
          type: FieldType.Dropdown,
          filterDropdownOptions:
            DropdownUtil.getDropdownOptionsFromEnum(CodeRepositoryType),
        },
        {
          field: {
            organizationName: true,
          },
          title: "Organization",
          type: FieldType.Text,
        },
        {
          field: {
            repositoryName: true,
          },
          title: "Repository",
          type: FieldType.Text,
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
          filterEntityType: Label,
          filterQuery: {
            projectId: ProjectUtil.getCurrentProjectId()!,
          },
          filterDropdownField: {
            label: "name",
            value: "_id",
          },
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
            repositoryHostedAt: true,
          },
          title: "Host",
          type: FieldType.Text,
        },
        {
          field: {
            organizationName: true,
          },
          title: "Organization",
          type: FieldType.Text,
        },
        {
          field: {
            repositoryName: true,
          },
          title: "Repository",
          type: FieldType.Text,
        },
        {
          field: {
            mainBranchName: true,
          },
          title: "Main Branch",
          type: FieldType.Text,
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
          getElement: (item: CodeRepository): ReactElement => {
            return <LabelsElement labels={item["labels"] || []} />;
          },
        },
      ]}
    />
  );
};

export default CodeRepositoryPage;
