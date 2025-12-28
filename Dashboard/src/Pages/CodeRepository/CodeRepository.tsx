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
        <div className={`grid gap-4 ${isGitHubAppConfigured ? "md:grid-cols-2" : "md:grid-cols-1"}`}>
          {/* GitHub App Option */}
          {isGitHubAppConfigured && (
            <div
              className="relative rounded-lg border border-gray-200 bg-white p-6 hover:border-indigo-500 hover:shadow-md transition-all cursor-pointer group"
              onClick={handleConnectWithGitHub}
            >
              <div className="flex items-start space-x-4">
                <div className="flex-shrink-0">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gray-900 text-white">
                    <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
                      <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                    </svg>
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-semibold text-gray-900 group-hover:text-indigo-600">
                    Connect with GitHub App
                  </h3>
                  <p className="mt-1 text-sm text-gray-500">
                    Recommended for GitHub repositories. Provides seamless integration with automatic authentication.
                  </p>
                  <div className="mt-3">
                    <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-1 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20">
                      Recommended
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Git Repository Option */}
          <div
            className="relative rounded-lg border border-gray-200 bg-white p-6 hover:border-indigo-500 hover:shadow-md transition-all cursor-pointer group"
            onClick={handleConnectWithGit}
          >
            <div className="flex items-start space-x-4">
              <div className="flex-shrink-0">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-indigo-600 text-white">
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
                  </svg>
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-gray-900 group-hover:text-indigo-600">
                  Connect with Access Token
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  Connect any Git repository (GitHub, GitLab, etc.) using a personal access token.
                </p>
                <div className="mt-3">
                  <span className="inline-flex items-center rounded-full bg-gray-50 px-2 py-1 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-500/10">
                    Universal
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
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
