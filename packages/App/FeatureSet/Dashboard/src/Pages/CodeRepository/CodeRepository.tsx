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
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import { APP_API_URL, env } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import AIPlanGate from "../../Components/AI/AIPlanGate";
import RepositoryConnectionStatus from "../../Components/CodeRepository/RepositoryConnectionStatus";
import {
  getGitHubConnectLock,
  GitHubConnectLock,
} from "../../Components/CodeRepository/GitHubConnectLock";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import URL from "Common/Types/API/URL";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import Exception from "Common/Types/Exception/Exception";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";

const CodeRepositoryPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [showGitHubConnectedBanner, setShowGitHubConnectedBanner] =
    useState<boolean>(false);
  const [refreshToggle, setRefreshToggle] = useState<string>("");
  const [connectError, setConnectError] = useState<string | null>(null);

  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<CodeRepository>({ modelType: CodeRepository });

  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  /*
   * Set while the click waits for the install URL, so a double click does
   * not start two connections. A ref, not state: the second click can land
   * before a re-render would have shown this handler a state flag.
   */
  const isConnectingToGitHubRef: MutableRefObject<boolean> =
    useRef<boolean>(false);

  useEffect(() => {
    /*
     * Check for installation_id in URL query params (returned from GitHub
     * after installing the app). The repositories in the installation were
     * already imported server-side by the install callback, so all that is
     * left to do here is show a success banner and refresh the table.
     */
    const urlParams: URLSearchParams = new URLSearchParams(
      window.location.search,
    );
    const installationId: string | null = urlParams.get("installation_id");

    if (installationId) {
      setShowGitHubConnectedBanner(true);
      setRefreshToggle(Date.now().toString());

      // Clean up the URL
      const newUrl: string = window.location.pathname;
      window.history.replaceState({}, document.title, newUrl);
    }
  }, []);

  const handleConnectWithGitHub: () => Promise<void> =
    async (): Promise<void> => {
      if (!projectId || isConnectingToGitHubRef.current) {
        return;
      }

      isConnectingToGitHubRef.current = true;
      setConnectError(null);

      /*
       * Install (or update) the GitHub App: once installed, every repository
       * in the installation is imported and kept in sync by webhooks.
       *
       * The server is asked for the installation URL through the API class,
       * as the Slack and Microsoft Teams connections ask for theirs. The
       * project goes in its tenant header, an expired session is refreshed
       * and the request replayed, and a refusal - no permission to add code
       * repositories, a plan without them - comes back here to be shown on
       * the card instead of on a bare error page. The URL carries a one-use
       * state the server recorded for this person, project and browser.
       */
      let installUrl: string | undefined = undefined;

      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.get<JSONObject>({
            url: URL.fromURL(APP_API_URL).addRoute("/github/install-url"),
            headers: ModelAPI.getCommonHeaders(),
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        installUrl = (response.data as JSONObject)["installUrl"] as
          | string
          | undefined;

        if (!installUrl) {
          throw new Error(
            translator.translateText(
              "OneUptime could not start the GitHub connection. Please try again.",
            ),
          );
        }
      } catch (error) {
        setConnectError(API.getFriendlyErrorMessage(error as Exception));
      }

      /*
       * Released before navigating, so a page the browser restores from its
       * back/forward cache (Back from GitHub) does not come back with a
       * button that ignores clicks.
       */
      isConnectingToGitHubRef.current = false;

      if (installUrl) {
        Navigation.navigate(URL.fromString(installUrl));
      }
    };

  // Read GitHub App Name fresh on each render to avoid module initialization timing issues
  const gitHubAppName: string | null = env("GITHUB_APP_NAME") || null;
  const isGitHubAppConfigured: boolean = Boolean(gitHubAppName);

  // Locked, with one sentence, for someone who may not connect it.
  const connectLock: GitHubConnectLock = getGitHubConnectLock();

  const aiAgentsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.AI_AGENT_TASKS] as Route,
  );

  return (
    <>
      <AIPlanGate />

      {showGitHubConnectedBanner && (
        <Alert
          type={AlertType.SUCCESS}
          strongTitle="GitHub connected"
          title="Your repositories were imported automatically."
          onClose={() => {
            setShowGitHubConnectedBanner(false);
          }}
        />
      )}

      {/* Connect Repository Card */}
      <Card
        title="Connect Repositories"
        description={
          <span>
            <TranslatedSentence
              template="Install the GitHub App and all repositories in the installation are imported automatically — no need to pick them one at a time. They stay in sync as repositories are added to or removed from the installation. Connected repositories are what the {{aiAgent}} opens fix pull requests against."
              slots={{
                aiAgent: (
                  <Link to={aiAgentsRoute} className="underline">
                    {translator.translateText("AI agent")}
                  </Link>
                ),
              }}
            />
          </span>
        }
      >
        {isGitHubAppConfigured ? (
          <div className="grid gap-4 md:grid-cols-2">
            {connectError && (
              <div className="md:col-span-2">
                <Alert
                  type={AlertType.DANGER}
                  title={connectError}
                  onClose={() => {
                    setConnectError(null);
                  }}
                />
              </div>
            )}
            {/*
             * GitHub App option. The whole card is the button's target: the
             * button inside the heading stretches over it (after:inset-0),
             * so the heading stays a heading and the button's name is just
             * its title.
             */}
            <div
              data-testid="connect-github-app-card"
              className={`relative rounded-lg border border-gray-200 bg-white p-6 transition-all group ${
                connectLock.isLocked
                  ? "opacity-75"
                  : "hover:border-indigo-500 hover:shadow-md"
              }`}
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
                  <h3 className="text-base font-semibold text-gray-900">
                    <button
                      type="button"
                      id="connect-github-app"
                      disabled={connectLock.isLocked}
                      aria-describedby={
                        connectLock.isLocked
                          ? "connect-github-app-lock"
                          : "connect-github-app-description"
                      }
                      className={`text-left after:absolute after:inset-0 after:rounded-lg ${
                        connectLock.isLocked
                          ? "cursor-not-allowed"
                          : "cursor-pointer group-hover:text-indigo-600"
                      }`}
                      onClick={() => {
                        void handleConnectWithGitHub();
                      }}
                    >
                      {translator.translateText("Connect with GitHub App")}
                    </button>
                  </h3>
                  <p
                    id="connect-github-app-description"
                    className="mt-1 text-sm text-gray-500"
                  >
                    {translator.translateText(
                      "Recommended for GitHub repositories. Installing the app imports all of its repositories automatically and keeps them in sync.",
                    )}
                  </p>
                  <div className="mt-3">
                    {connectLock.isLocked ? (
                      <div
                        id="connect-github-app-lock"
                        className="flex items-center gap-1.5 text-sm text-gray-600"
                      >
                        <Icon
                          icon={IconProp.Lock}
                          className="h-4 w-4 flex-none text-gray-400"
                        />
                        <span>{connectLock.reason}</span>
                      </div>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-1 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20">
                        {translator.translateText("Recommended")}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-6">
            <h3 className="text-base font-semibold text-gray-900">
              {translator.translateText(
                "GitHub App is not configured on this server",
              )}
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              <TranslatedSentence
                template="Connecting a repository requires the GitHub App environment variables (like {{appName}} and {{appId}}) to be configured on your OneUptime server. See the {{documentation}} for setup instructions."
                slots={{
                  appName: <code>GITHUB_APP_NAME</code>,
                  appId: <code>GITHUB_APP_ID</code>,
                  documentation: (
                    <Link
                      to={Route.fromString(
                        "/docs/self-hosted/github-integration",
                      )}
                      openInNewTab={true}
                      className="underline"
                    >
                      {translator.translateText(
                        "GitHub Integration documentation",
                      )}
                    </Link>
                  ),
                }}
              />
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
            "Your connected code repositories. AI analyzes these and opens fix pull requests against them.",
        }}
        showViewIdButton={true}
        noItemsMessage={
          isGitHubAppConfigured
            ? "No repositories connected. Use the card above to install the GitHub App — all repositories in the installation are imported automatically."
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
    </>
  );
};

export default CodeRepositoryPage;
