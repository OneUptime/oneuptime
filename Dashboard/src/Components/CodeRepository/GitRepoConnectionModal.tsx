import React, { FunctionComponent, ReactElement } from "react";
import ObjectID from "Common/Types/ObjectID";
import CodeRepository from "Common/Models/DatabaseModels/CodeRepository";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import DropdownUtil from "Common/UI/Utils/Dropdown";

export interface ComponentProps {
  projectId: ObjectID;
  onClose: () => void;
  onSuccess: () => void;
}

const GitRepoConnectionModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ModelFormModal<CodeRepository>
      title="Connect Git Repository"
      description="Connect a Git repository using an access token for authentication."
      modelType={CodeRepository}
      name="Connect Git Repository"
      onClose={props.onClose}
      submitButtonText="Connect Repository"
      submitButtonStyleType={ButtonStyleType.PRIMARY}
      onSuccess={() => {
        props.onSuccess();
      }}
      formProps={{
        name: "Connect Git Repository",
        modelType: CodeRepository,
        id: "connect-git-repository",
        fields: [
          {
            field: {
              name: true,
            },
            title: "Display Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "My Backend API",
            description: "A friendly name for this repository",
          },
          {
            field: {
              repositoryHostedAt: true,
            },
            title: "Repository Host",
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
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "my-organization",
            description: "The organization or username that owns the repository",
          },
          {
            field: {
              repositoryName: true,
            },
            title: "Repository Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "my-backend-api",
          },
          {
            field: {
              mainBranchName: true,
            },
            title: "Main Branch",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "main",
            description: "The main branch of the repository (defaults to 'main')",
          },
          {
            field: {
              secretToken: true,
            },
            title: "Access Token",
            fieldType: FormFieldSchemaType.Password,
            required: true,
            placeholder: "Enter your access token",
            description:
              "Create a Personal Access Token with repository access. For GitHub: Settings > Developer settings > Personal access tokens. For GitLab: Settings > Access Tokens.",
          },
        ],
        formType: FormType.Create,
      }}
      initialValues={{
        projectId: props.projectId,
        mainBranchName: "main",
      }}
    />
  );
};

export default GitRepoConnectionModal;
