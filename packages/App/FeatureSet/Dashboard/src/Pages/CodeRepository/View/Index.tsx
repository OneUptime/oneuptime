import LabelsElement from "Common/UI/Components/Label/Labels";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import Navigation from "Common/UI/Utils/Navigation";
import getLabelsFormField from "../../../Utils/Form/LabelsFormField";
import CodeRepository from "Common/Models/DatabaseModels/CodeRepository";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import RepositoryConnectionStatus from "../../../Components/CodeRepository/RepositoryConnectionStatus";

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
        /*
         * What the repository is called (its labels folded under Advanced
         * there), then where its code lives: one step of six fields before.
         */
        formSteps={[
          {
            title: "Repository Info",
            id: "repository-info",
          },
          {
            title: "Source",
            id: "source",
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
          getLabelsFormField<CodeRepository>({
            stepId: "repository-info",
          }),
          {
            field: {
              repositoryHostedAt: true,
            },
            stepId: "source",
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
            stepId: "source",
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
            stepId: "source",
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
            stepId: "source",
            title: "Main Branch",
            description:
              "The main branch of the repository (e.g., main, master).",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "main",
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
                return (
                  <RepositoryConnectionStatus
                    gitHubAppInstallationId={item.gitHubAppInstallationId}
                  />
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
