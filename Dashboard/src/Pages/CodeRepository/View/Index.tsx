import LabelsElement from "Common/UI/Components/Label/Labels";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import Navigation from "Common/UI/Utils/Navigation";
import Label from "Common/Models/DatabaseModels/Label";
import CodeRepository from "Common/Models/DatabaseModels/CodeRepository";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green } from "Common/Types/BrandColors";

const CodeRepositoryView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  return (
    <Fragment>
      <CardModelDetail<CodeRepository>
        name="Repository > Repository Details"
        cardProps={{
          title: "Repository Details",
          description: "Here are more details for this repository.",
        }}
        formSteps={[
          {
            title: "Repository Info",
            id: "repository-info",
          },
          {
            title: "Labels",
            id: "labels",
          },
        ]}
        isEditable={true}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            stepId: "repository-info",
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
            stepId: "repository-info",
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Description",
          },
          {
            field: {
              repositoryHostedAt: true,
            },
            stepId: "repository-info",
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
            stepId: "repository-info",
            title: "Organization / Username",
            description:
              "The GitHub organization or username that owns the repository.",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Organization Name",
          },
          {
            field: {
              repositoryName: true,
            },
            stepId: "repository-info",
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
            stepId: "repository-info",
            title: "Main Branch",
            description:
              "The main branch of the repository (e.g., main, master).",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "main",
          },
          {
            field: {
              labels: true,
            },
            title: "Labels",
            stepId: "labels",
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
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: CodeRepository,
          id: "model-detail-code-repository",
          selectMoreFields: {
            gitHubAppInstallationId: true,
          },
          fields: [
            {
              field: {
                _id: true,
              },
              title: "Repository ID",
              fieldType: FieldType.ObjectID,
            },
            {
              field: {
                name: true,
              },
              title: "Name",
            },
            {
              field: {
                repositoryHostedAt: true,
              },
              title: "Repository Host",
            },
            {
              field: {
                organizationName: true,
              },
              title: "Organization",
            },
            {
              field: {
                repositoryName: true,
              },
              title: "Repository",
            },
            {
              field: {
                mainBranchName: true,
              },
              title: "Main Branch",
            },
            {
              field: {
                gitHubAppInstallationId: true,
              },
              title: "Connection Type",
              fieldType: FieldType.Element,
              getElement: (item: CodeRepository): ReactElement => {
                if (item.gitHubAppInstallationId) {
                  return (
                    <div className="flex items-center gap-2">
                      <Pill color={Green} text="GitHub App" />
                      <span className="text-sm text-gray-500">
                        Connected via GitHub App integration
                      </span>
                    </div>
                  );
                }
                // If not connected via GitHub App, it's either via token or manual entry
                return (
                  <span className="text-sm text-gray-500">
                    Connected via access token or manual entry
                  </span>
                );
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
              fieldType: FieldType.Element,
              getElement: (item: CodeRepository): ReactElement => {
                return <LabelsElement labels={item["labels"] || []} />;
              },
            },
            {
              field: {
                description: true,
              },
              title: "Description",
            },
          ],
          modelId: modelId,
        }}
      />
    </Fragment>
  );
};

export default CodeRepositoryView;
