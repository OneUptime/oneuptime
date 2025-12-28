import LabelsElement from "Common/UI/Components/Label/Labels";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
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
import { env, HOME_URL } from "Common/UI/Config";
import UserUtil from "Common/UI/Utils/User";
import GitHubRepoSelectorModal from "../../Components/CodeRepository/GitHubRepoSelectorModal";
import GitRepoConnectionModal from "../../Components/CodeRepository/GitRepoConnectionModal";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import Card from "Common/UI/Components/Card/Card";
import ObjectID from "Common/Types/ObjectID";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green } from "Common/Types/BrandColors";

const CodeRepositoryPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [showGitHubModal, setShowGitHubModal] = useState<boolean>(false);
  const [showGitModal, setShowGitModal] = useState<boolean>(false);
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

  const handleConnectWithGit: () => void = (): void => {
    setShowGitModal(true);
  };

  const handleGitHubModalClose: () => void = (): void => {
    setShowGitHubModal(false);
    setGitHubInstallationId(null);
  };

  const handleGitModalClose: () => void = (): void => {
    setShowGitModal(false);
  };

  const handleRepoConnected: () => void = (): void => {
    setShowGitHubModal(false);
    setShowGitModal(false);
    setGitHubInstallationId(null);
    // Refresh the table
    setRefreshToggle(Date.now().toString());
  };

  // Read GitHub App Name fresh on each render to avoid module initialization timing issues
  const gitHubAppName: string | null = env("GITHUB_APP_NAME") || null;
  const isGitHubAppConfigured: boolean = Boolean(gitHubAppName);

  return (
    <>
      {/* Connect Repository Card */}
      <Card
        title="Connect Repository"
        description="Connect your code repositories to enable code analysis, automatic improvements, and CI/CD integration."
      >
        <div className="flex flex-wrap items-center gap-4">
          {isGitHubAppConfigured && (
            <Button
              title="Connect GitHub Repository"
              icon={IconProp.Link}
              buttonStyle={ButtonStyleType.PRIMARY}
              onClick={handleConnectWithGitHub}
            />
          )}
          <Button
            title="Connect Git Repository"
            icon={IconProp.Code}
            buttonStyle={ButtonStyleType.OUTLINE}
            onClick={handleConnectWithGit}
          />
        </div>
        <p className="mt-3 text-sm text-gray-500">
          {isGitHubAppConfigured
            ? "Use the GitHub App for seamless integration, or connect any Git repository with an access token."
            : "Connect any Git repository using an access token for authentication."}
        </p>
      </Card>

      <ModelTable<CodeRepository>
        modelType={CodeRepository}
        id="code-repository-table"
        userPreferencesKey="code-repository-table"
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        name="Code Repositories"
        isViewable={true}
        refreshToggle={refreshToggle}
        cardProps={{
          title: "Code Repositories",
          description:
            "Your connected code repositories for code analysis and improvements.",
        }}
        showViewIdButton={true}
        noItemsMessage={"No repositories connected. Use the buttons above to connect a repository."}
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
              gitHubAppInstallationId: true,
            },
            title: "Connection",
            type: FieldType.Element,
            getElement: (item: CodeRepository): ReactElement => {
              if (item.gitHubAppInstallationId) {
                return (
                  <Pill color={Green} text="GitHub App" />
                );
              }
              // If not connected via GitHub App, it's either via token or manual
              // We can't check secretToken directly due to read permissions
              return <span className="text-gray-500">Token / Manual</span>;
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
          onSuccess={handleRepoConnected}
        />
      )}

      {/* Git Repository Connection Modal */}
      {showGitModal && projectId && (
        <GitRepoConnectionModal
          projectId={projectId}
          onClose={handleGitModalClose}
          onSuccess={handleRepoConnected}
        />
      )}
    </>
  );
};

export default CodeRepositoryPage;
