import LabelsElement from "Common/UI/Components/Label/Labels";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import Link from "Common/UI/Components/Link/Link";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import FieldType from "Common/UI/Components/Types/FieldType";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import Navigation from "Common/UI/Utils/Navigation";
import Label from "Common/Models/DatabaseModels/Label";
import CodeRepository from "Common/Models/DatabaseModels/CodeRepository";
import Project from "Common/Models/DatabaseModels/Project";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { env, HOME_URL } from "Common/UI/Config";
import UserUtil from "Common/UI/Utils/User";
import AIPlanGate from "../../Components/AI/AIPlanGate";
import GitHubRepoSelectorModal from "../../Components/CodeRepository/GitHubRepoSelectorModal";
import RepositoryConnectionStatus from "../../Components/CodeRepository/RepositoryConnectionStatus";
import Card from "Common/UI/Components/Card/Card";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";

const CodeRepositoryPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [showGitHubModal, setShowGitHubModal] = useState<boolean>(false);
  const [gitHubInstallationId, setGitHubInstallationId] = useState<
    string | null
  >(null);
  const [projectInstallationId, setProjectInstallationId] = useState<
    string | null
  >(null);
  const [refreshToggle, setRefreshToggle] = useState<string>("");

  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<CodeRepository>({ modelType: CodeRepository });

  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  // Fetch GitHub installation ID from project
  const fetchProjectInstallationId: () => Promise<void> =
    async (): Promise<void> => {
      if (!projectId) {
        return;
      }

      try {
        const project: Project | null = await ModelAPI.getItem({
          modelType: Project,
          id: projectId,
          select: {
            gitHubAppInstallationId: true,
          },
        });

        if (project?.gitHubAppInstallationId) {
          setProjectInstallationId(project.gitHubAppInstallationId);
        }
      } catch (err: unknown) {
        // Silently fail - we'll just redirect to GitHub if we can't get the installation ID
        API.getFriendlyErrorMessage(err as Error);
      }
    };

  useEffect(() => {
    // Check for installation_id in URL query params (returned from GitHub OAuth)
    const urlParams: URLSearchParams = new URLSearchParams(
      window.location.search,
    );
    const installationId: string | null = urlParams.get("installation_id");

    if (installationId) {
      setGitHubInstallationId(installationId);
      setProjectInstallationId(installationId); // Also update the project installation ID
      setShowGitHubModal(true);

      // Clean up the URL
      const newUrl: string = window.location.pathname;
      window.history.replaceState({}, document.title, newUrl);
    }

    // Fetch installation ID from project
    fetchProjectInstallationId();
  }, []);

  const handleConnectWithGitHub: () => void = (): void => {
    if (!projectId) {
      return;
    }

    // If project already has an installation ID, show the modal directly
    if (projectInstallationId) {
      setGitHubInstallationId(projectInstallationId);
      setShowGitHubModal(true);
      return;
    }

    // Otherwise, redirect to GitHub for fresh installation
    const userId: ObjectID = UserUtil.getUserId();
    const installUrl: string = `${HOME_URL.toString()}api/github/auth/install?projectId=${projectId.toString()}&userId=${userId.toString()}`;
    window.location.href = installUrl;
  };

  const handleGitHubModalClose: () => void = (): void => {
    setShowGitHubModal(false);
    setGitHubInstallationId(null);
  };

  const handleRepoConnected: () => void = (): void => {
    setShowGitHubModal(false);
    setGitHubInstallationId(null);
    // Refresh the table
    setRefreshToggle(Date.now().toString());
  };

  /**
   * Called when the GitHub App installation is no longer valid (e.g., uninstalled from GitHub).
   * This clears the stale installation ID and redirects the user to GitHub for a fresh installation.
   */
  const handleInstallationExpired: () => void = (): void => {
    // Close the modal
    setShowGitHubModal(false);
    setGitHubInstallationId(null);

    // Clear the stale project installation ID (backend already cleared it from the database)
    setProjectInstallationId(null);

    // Redirect to GitHub for a fresh installation
    if (projectId) {
      const userId: ObjectID = UserUtil.getUserId();
      const installUrl: string = `${HOME_URL.toString()}api/github/auth/install?projectId=${projectId.toString()}&userId=${userId.toString()}`;
      window.location.href = installUrl;
    }
  };

  // Read GitHub App Name fresh on each render to avoid module initialization timing issues
  const gitHubAppName: string | null = env("GITHUB_APP_NAME") || null;
  const isGitHubAppConfigured: boolean = Boolean(gitHubAppName);

  const aiAgentsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.AI_AGENT_TASKS] as Route,
  );

  return (
    <>
      <AIPlanGate />

      {/* Connect Repository Card */}
      <Card
        title="Connect Repository"
        description={
          <span>
            Connect your code repositories to enable code analysis and automatic
            improvements. Connected repositories are what the{" "}
            <Link to={aiAgentsRoute} className="underline">
              AI agent
            </Link>{" "}
            opens fix pull requests against.
          </span>
        }
      >
        {isGitHubAppConfigured ? (
          <div className="grid gap-4 md:grid-cols-2">
            {/* GitHub App Option */}
            <div
              className="relative rounded-lg border border-gray-200 bg-white p-6 hover:border-indigo-500 hover:shadow-md transition-all cursor-pointer group"
              onClick={handleConnectWithGitHub}
            >
              <div className="flex items-start space-x-4">
                <div className="flex-shrink-0">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gray-900 text-white">
                    <svg
                      className="h-6 w-6"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        fillRule="evenodd"
                        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-semibold text-gray-900 group-hover:text-indigo-600">
                    Connect with GitHub App
                  </h3>
                  <p className="mt-1 text-sm text-gray-500">
                    Recommended for GitHub repositories. Provides seamless
                    integration with automatic authentication.
                  </p>
                  <div className="mt-3">
                    <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-1 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20">
                      Recommended
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-6">
            <h3 className="text-base font-semibold text-gray-900">
              GitHub App is not configured on this server
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              Connecting a repository requires the GitHub App environment
              variables (like <code>GITHUB_APP_NAME</code> and{" "}
              <code>GITHUB_APP_ID</code>) to be configured on your OneUptime
              server. See the{" "}
              <Link
                to={Route.fromString("/docs/self-hosted/github-integration")}
                openInNewTab={true}
                className="underline"
              >
                GitHub Integration documentation
              </Link>{" "}
              for setup instructions.
            </p>
          </div>
        )}
      </Card>

      <ModelTable<CodeRepository>
        modelType={CodeRepository}
        id="code-repository-table"
        userPreferencesKey="code-repository-table"
        saveFilterProps={{
          tableId: "code-repository-table",
        }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        bulkActions={{
          buttons: [...labelBulkActions],
        }}
        name="Code Repositories"
        isViewable={true}
        refreshToggle={refreshToggle}
        cardProps={{
          title: "Code Repositories",
          description:
            "Your connected code repositories. The AI agent analyzes these and opens fix pull requests against them.",
        }}
        showViewIdButton={true}
        noItemsMessage={
          isGitHubAppConfigured
            ? "No repositories connected. Use the card above to connect a repository."
            : "No repositories connected. Configure the GitHub App on your server to connect repositories."
        }
        showRefreshButton={true}
        searchableFields={["name", "description"]}
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
            type: FieldType.EntityArray,
            getElement: (item: CodeRepository): ReactElement => {
              return <LabelsElement labels={item["labels"] || []} />;
            },
          },
        ]}
      />

      {labelBulkActionModals}

      {/* GitHub Repository Selector Modal */}
      {showGitHubModal && gitHubInstallationId && projectId && (
        <GitHubRepoSelectorModal
          projectId={projectId}
          installationId={gitHubInstallationId}
          onClose={handleGitHubModalClose}
          onSuccess={handleRepoConnected}
          onInstallationExpired={handleInstallationExpired}
        />
      )}
    </>
  );
};

export default CodeRepositoryPage;
