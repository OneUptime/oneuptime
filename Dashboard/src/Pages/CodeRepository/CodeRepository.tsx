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
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import { GitHubAppClientId, HOME_URL } from "Common/UI/Config";
import UserUtil from "Common/UI/Utils/User";
import GitHubRepoSelectorModal from "../../Components/CodeRepository/GitHubRepoSelectorModal";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import Card from "Common/UI/Components/Card/Card";
import ObjectID from "Common/Types/ObjectID";

const CodeRepositoryPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [showGitHubModal, setShowGitHubModal] = useState<boolean>(false);
  const [gitHubInstallationId, setGitHubInstallationId] = useState<
    string | null
  >(null);
  const [refreshToggle, setRefreshToggle] = useState<string>("");

  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  useEffect(() => {
    // Check for installation_id in URL query params (returned from GitHub OAuth)
    const urlParams: URLSearchParams = new URLSearchParams(
      window.location.search,
    );
    const installationId: string | null = urlParams.get("installation_id");

    if (installationId) {
      setGitHubInstallationId(installationId);
      setShowGitHubModal(true);

      // Clean up the URL
      const newUrl: string = window.location.pathname;
      window.history.replaceState({}, document.title, newUrl);
    }
  }, []);

  const handleConnectWithGitHub: () => void = (): void => {
    if (!projectId) {
      return;
    }

    const userId: ObjectID = UserUtil.getUserId();

    // Redirect to GitHub App installation
    const installUrl: string = `${HOME_URL.toString()}/api/github/auth/install?projectId=${projectId.toString()}&userId=${userId.toString()}`;
    window.location.href = installUrl;
  };

  const handleGitHubModalClose: () => void = (): void => {
    setShowGitHubModal(false);
    setGitHubInstallationId(null);
  };

  const handleGitHubRepoConnected: () => void = (): void => {
    setShowGitHubModal(false);
    setGitHubInstallationId(null);
    // Refresh the table
    setRefreshToggle(Date.now().toString());
  };

  const isGitHubAppConfigured: boolean = Boolean(GitHubAppClientId);

  return (
    <>
      {/* GitHub Connect Button */}
      {isGitHubAppConfigured && (
        <Card
          title="Connect with GitHub"
          description="Install the OneUptime GitHub App to automatically import repositories with full access for code analysis and automatic improvements."
        >
          <div className="flex items-center gap-4">
            <Button
              title="Connect with GitHub"
              icon={IconProp.Link}
              buttonStyle={ButtonStyleType.PRIMARY}
              onClick={handleConnectWithGitHub}
            />
            <span className="text-sm text-gray-500">
              Or use the manual form below to add a repository without GitHub
              App access.
            </span>
          </div>
        </Card>
      )}

      <ModelTable<CodeRepository>
        modelType={CodeRepository}
        id="code-repository-table"
        userPreferencesKey="code-repository-table"
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        name="Code Repositories"
        isViewable={true}
        refreshToggle={refreshToggle}
        cardProps={{
          title: "Code Repositories",
          description:
            "Connect and manage your GitHub and GitLab repositories here.",
        }}
        showViewIdButton={true}
        noItemsMessage={"No repositories connected."}
        formSteps={[
          {
            title: "Basic Info",
            id: "basic-info",
          } as FormStep<CodeRepository>,
          {
            title: "Repository Details",
            id: "repository-details",
          } as FormStep<CodeRepository>,
          {
            title: "Labels",
            id: "labels",
          } as FormStep<CodeRepository>,
        ]}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            stepId: "basic-info",
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
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Description",
          },
          {
            field: {
              repositoryHostedAt: true,
            },
            title: "Repository Host",
            stepId: "repository-details",
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
            stepId: "repository-details",
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
            title: "Repository Name",
            stepId: "repository-details",
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
            stepId: "repository-details",
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

      {/* GitHub Repository Selector Modal */}
      {showGitHubModal && gitHubInstallationId && projectId && (
        <GitHubRepoSelectorModal
          projectId={projectId}
          installationId={gitHubInstallationId}
          onClose={handleGitHubModalClose}
          onSuccess={handleGitHubRepoConnected}
        />
      )}
    </>
  );
};

export default CodeRepositoryPage;
