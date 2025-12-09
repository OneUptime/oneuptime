import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
} from "react";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import IconProp from "Common/Types/Icon/IconProp";
import Navigation from "Common/UI/Utils/Navigation";
import URL from "Common/Types/API/URL";
import {
  APP_API_URL,
  BILLING_ENABLED,
  HOME_URL,
  MicrosoftTeamsAppClientId,
} from "Common/UI/Config";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import API from "Common/Utils/API";
import Exception from "Common/Types/Exception/Exception";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import WorkspaceProjectAuthToken, {
  MicrosoftTeamsMiscData,
} from "Common/Models/DatabaseModels/WorkspaceProjectAuthToken";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import WorkspaceUserAuthToken from "Common/Models/DatabaseModels/WorkspaceUserAuthToken";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import MicrosoftTeamsIntegrationDocumentation from "./MicrosoftTeamsIntegrationDocumentation";
import Link from "Common/UI/Components/Link/Link";
import { ButtonStyleType as SharedButtonStyle } from "Common/UI/Components/Button/Button";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/MarkdownViewer";
import TeamsAvailableModal from "./TeamsAvailableModal";

export interface ComponentProps {
  onConnected: VoidFunction;
  onDisconnected: VoidFunction;
}

const MicrosoftTeamsIntegration: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [error, setError] = React.useState<ReactElement | null>(null);

  const [isLoading, setIsLoading] = React.useState<boolean>(true);

  const [isUserAccountConnected, setIsUserAccountConnected] =
    React.useState<boolean>(false);
  const [userAuthTokenId, setWorkspaceUserAuthTokenId] =
    React.useState<ObjectID | null>(null);
  const [projectAuthTokenId, setWorkspaceProjectAuthTokenId] =
    React.useState<ObjectID | null>(null);
  const [isProjectAccountConnected, setIsProjectAccountConnected] =
    React.useState<boolean>(false);
  const [isButtonLoading, setIsButtonLoading] = React.useState<boolean>(false);
  const [isAdminConsentCompleted, setIsAdminConsentCompleted] =
    React.useState<boolean>(false);
  const [isRefreshTeamsLoading, setIsRefreshTeamsLoading] =
    React.useState<boolean>(false);

  // Teams Modal state
  interface TeamItem {
    id: string;
    name: string;
  }

  const [isTeamsModalOpen, setIsTeamsModalOpen] =
    React.useState<boolean>(false);
  const [teams, setTeams] = React.useState<Array<TeamItem>>([]);
  const [isTeamsLoading, setIsTeamsLoading] = React.useState<boolean>(false);
  const [teamsError, setTeamsError] = React.useState<string>("");

  const loadTeams: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setTeamsError("");
      setIsTeamsLoading(true);

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get<JSONObject>({
          url: URL.fromURL(APP_API_URL).addRoute("/microsoft-teams/teams"),
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      const data: JSONObject = response.data as JSONObject;
      const list: Array<TeamItem> = ((data["teams"] as Array<JSONObject>) || [])
        .map((t: JSONObject) => {
          return {
            id: (t["id"] as string) || "",
            name: (t["name"] as string) || "",
          };
        })
        .filter((t: TeamItem) => {
          return t.id && t.name;
        });

      setTeams(list);
    } catch (err) {
      setTeamsError(API.getFriendlyErrorMessage(err as Exception));
    } finally {
      setIsTeamsLoading(false);
    }
  };

  const openTeamsModal: VoidFunction = (): void => {
    setIsTeamsModalOpen(true);
    // Load teams on open
    loadTeams().catch((error: Exception) => {
      setTeamsError(API.getFriendlyErrorMessage(error));
    });
  };

  useEffect(() => {
    if (isProjectAccountConnected) {
      props.onConnected();
    } else {
      props.onDisconnected();
    }
  }, [isProjectAccountConnected]);

  const loadItems: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setError(null);
      setIsLoading(true);

      // check if the project is already connected with Microsoft Teams.
      const projectAuth: ListResult<WorkspaceProjectAuthToken> =
        await ModelAPI.getList<WorkspaceProjectAuthToken>({
          modelType: WorkspaceProjectAuthToken,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
            workspaceType: WorkspaceType.MicrosoftTeams,
          },
          select: {
            _id: true,
            miscData: true,
            workspaceProjectId: true,
          },
          limit: 1,
          skip: 0,
          sort: {
            createdAt: SortOrder.Descending,
          },
        });

      if (projectAuth.data.length > 0) {
        const miscData: MicrosoftTeamsMiscData = projectAuth.data[0]!
          .miscData! as MicrosoftTeamsMiscData;

        setWorkspaceProjectAuthTokenId(projectAuth.data[0]!.id);

        // Check if admin consent is granted
        const adminConsentGranted: boolean =
          miscData.adminConsentGranted || false;
        setIsAdminConsentCompleted(adminConsentGranted);

        // Project is connected if there's a project auth token
        setIsProjectAccountConnected(true);
      }

      // fetch user auth token.

      const userAuth: ListResult<WorkspaceUserAuthToken> =
        await ModelAPI.getList<WorkspaceUserAuthToken>({
          modelType: WorkspaceUserAuthToken,
          query: {
            userId: UserUtil.getUserId()!,
            workspaceType: WorkspaceType.MicrosoftTeams,
          },
          select: {
            _id: true,
            miscData: true,
          },
          limit: 1,
          skip: 0,
          sort: {
            createdAt: SortOrder.Descending,
          },
        });

      if (userAuth.data.length > 0) {
        setIsUserAccountConnected(true);
        setWorkspaceUserAuthTokenId(userAuth.data[0]!.id);
      }
    } catch (error) {
      setError(<div>{API.getFriendlyErrorMessage(error as Error)}</div>);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // if this page has a query param with error, then there was the error in authentication.
    const error: string | null = Navigation.getQueryStringByName("error");

    if (error) {
      setError(
        <div>
          There was an error while connecting with Microsoft Teams. Please try
          again.
          <br />
          Error: {error}
        </div>,
      );
      setIsLoading(false);
      return;
    }

    loadItems().catch((error: Exception) => {
      setError(<div>{API.getFriendlyErrorMessage(error)}</div>);
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  let cardTitle: string = "";
  let cardDescription: string = "";
  let cardButtons: Array<CardButtonSchema> = [];

  // if user and project both connected with Microsoft Teams, then.
  if (isUserAccountConnected && isProjectAccountConnected) {
    cardTitle = `You are connected with Microsoft Teams`;
    cardDescription = `Your account is already connected with Microsoft Teams. You can now create workspace notification rules to send messages to your teams.`;
    cardButtons = [
      {
        title: `Disconnect`,
        isLoading: isButtonLoading,
        buttonStyle: SharedButtonStyle.DANGER,
        onClick: async () => {
          try {
            setIsButtonLoading(true);
            setError(null);
            if (userAuthTokenId) {
              await ModelAPI.deleteItem({
                modelType: WorkspaceUserAuthToken,
                id: userAuthTokenId!,
              });

              setIsUserAccountConnected(false);
              setWorkspaceUserAuthTokenId(null);
            } else {
              setError(
                <div>
                  Looks like the user auth token id is not set properly. Please
                  try again.
                </div>,
              );
            }
          } catch (error) {
            setError(
              <div>{API.getFriendlyErrorMessage(error as Exception)}</div>,
            );
          }
          setIsButtonLoading(false);
        },
        icon: IconProp.Close,
      },
    ];
  }

  const connectWithTeams: VoidFunction = (): void => {
    if (MicrosoftTeamsAppClientId) {
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
      const userId: ObjectID | null = UserUtil.getUserId();

      if (!projectId) {
        setError(
          <div>
            Looks like you have not selected any project. Please select a
            project to continue.
          </div>,
        );
        return;
      }

      if (!userId) {
        setError(
          <div>
            Looks like you are not logged in. Please login to continue.
          </div>,
        );
        return;
      }

      // Use static redirect URI (no projectId/userId in path) and encode both values in the state param.
      const redirectUri: string = `${APP_API_URL}/microsoft-teams/auth`;
      const scopes: string =
        "https://graph.microsoft.com/User.Read https://graph.microsoft.com/Team.ReadBasic.All https://graph.microsoft.com/Channel.ReadBasic.All https://graph.microsoft.com/ChannelMessage.Send";
      const state: string = `${projectId.toString()}:${userId.toString()}`;

      if (!isProjectAccountConnected) {
        // Install the app and connect the project
        Navigation.navigate(
          URL.fromString(
            `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${MicrosoftTeamsAppClientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&response_mode=query&scope=${encodeURIComponent(scopes)}&state=${encodeURIComponent(state)}`,
          ),
        );
      } else {
        // if project account is already connected then we just need to sign in with Teams and not install the app.
        Navigation.navigate(
          URL.fromString(
            `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${MicrosoftTeamsAppClientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&response_mode=query&scope=${encodeURIComponent(scopes)}&state=${encodeURIComponent(state)}`,
          ),
        );
      }
    } else {
      setError(
        <div>
          Looks like the Microsoft Teams App Client ID is not set in the
          environment variables when you installed OneUptime. For more
          information, please check this guide to set up Microsoft Teams App
          properly:{" "}
          <Link
            to={new Route("/docs/self-hosted/microsoft-teams-integration")}
            openInNewTab={true}
          >
            Microsoft Teams Integration
          </Link>
        </div>,
      );
    }
  };

  type GetConnectWithTeamsButtonFunction = (title: string) => CardButtonSchema;

  const getConnectWithTeamsButton: GetConnectWithTeamsButtonFunction = (
    title: string,
  ): CardButtonSchema => {
    return {
      title: title || `Connect with Microsoft Teams`,
      buttonStyle: SharedButtonStyle.PRIMARY,
      onClick: () => {
        return connectWithTeams();
      },
      icon: IconProp.MicrosoftTeams,
    };
  };

  const startAdminConsent: VoidFunction = (): void => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    const userId: ObjectID | null = UserUtil.getUserId();
    if (!projectId || !userId) {
      setError(<div>Missing project or user context.</div>);
      return;
    }
    const state: string = `${projectId.toString()}:${userId.toString()}`;
    Navigation.navigate(
      URL.fromString(
        `${HOME_URL.toString()}api/microsoft-teams/admin-consent?state=${encodeURIComponent(
          state,
        )}`,
      ),
    );
  };

  const refreshTeams: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setIsRefreshTeamsLoading(true);
      setError(null);

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromURL(APP_API_URL).addRoute(
            `/microsoft-teams/refresh-teams`,
          ),
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      // Reload the component to get updated teams
      await loadItems();
    } catch (error) {
      setError(<div>{API.getFriendlyErrorMessage(error as Exception)}</div>);
    } finally {
      setIsRefreshTeamsLoading(false);
    }
  };

  // if user is not connected and the project is connected with Teams.
  if (!isUserAccountConnected && isProjectAccountConnected) {
    cardTitle = `You are disconnected from Microsoft Teams`;
    cardDescription = `Connect your account with Microsoft Teams to make the most out of OneUptime.`;
    cardButtons = [
      // connect with Teams button.
      getConnectWithTeamsButton(`Connect my account with Microsoft Teams`),
      {
        title: `Uninstall OneUptime from Microsoft Teams`,
        isLoading: isButtonLoading,
        buttonStyle: SharedButtonStyle.DANGER,
        onClick: async () => {
          try {
            setIsButtonLoading(true);
            setError(null);
            if (projectAuthTokenId) {
              await ModelAPI.deleteItem({
                modelType: WorkspaceProjectAuthToken,
                id: projectAuthTokenId!,
              });

              setIsProjectAccountConnected(false);
              setIsAdminConsentCompleted(false); // Reset admin consent when project is disconnected
              setWorkspaceProjectAuthTokenId(null);
            } else {
              setError(
                <div>
                  Looks like the project auth token id is not set properly.
                  Please try again.
                </div>,
              );
            }
          } catch (error) {
            setError(
              <div>{API.getFriendlyErrorMessage(error as Exception)}</div>,
            );
          }
          setIsButtonLoading(false);
        },
        icon: IconProp.Trash,
      },
    ];
  }

  // if admin consent is completed but no team is selected yet
  if (
    isAdminConsentCompleted &&
    !isProjectAccountConnected &&
    !isUserAccountConnected
  ) {
    cardTitle = `Admin Consent Granted - Connect Your Account`;
    cardDescription = `Admin consent has been granted for the OneUptime Microsoft Teams app. Now connect your account to select a team and complete the setup.`;
    cardButtons = [getConnectWithTeamsButton(`Connect with Microsoft Teams`)];
  }

  if (!isProjectAccountConnected && !isAdminConsentCompleted) {
    cardTitle = `Connect with Microsoft Teams`;
    cardDescription = `Connect your account with Microsoft Teams to make the most out of OneUptime.`;
    cardButtons = [getConnectWithTeamsButton(`Connect with Microsoft Teams`)];
  }

  if (!MicrosoftTeamsAppClientId) {
    return <MicrosoftTeamsIntegrationDocumentation />;
  }

  return (
    <Fragment>
      <div className="mt-6">
        <Card
          title={
            isAdminConsentCompleted
              ? "Admin Consent Completed"
              : "Grant Admin Consent"
          }
          description={
            isAdminConsentCompleted
              ? "Admin consent has been successfully granted for the OneUptime Microsoft Teams app. You can now proceed to connect your account."
              : "Grant tenant-wide admin consent for the OneUptime Microsoft Teams app. This step is required to enable application permissions (e.g., posting to channels) without per-user consent. You must be a Microsoft 365 admin."
          }
          buttons={
            isAdminConsentCompleted
              ? [
                  {
                    title: "Reset Admin Consent",
                    buttonStyle: SharedButtonStyle.NORMAL,
                    icon: IconProp.Refresh,
                    onClick: () => {
                      setIsAdminConsentCompleted(false);
                    },
                  },
                  {
                    title: "View Teams",
                    buttonStyle: SharedButtonStyle.NORMAL,
                    icon: IconProp.Team,
                    onClick: () => {
                      return openTeamsModal();
                    },
                  },
                ]
              : [
                  {
                    title: "Grant Admin Consent",
                    buttonStyle: SharedButtonStyle.PRIMARY,
                    icon: IconProp.ShieldCheck,
                    onClick: () => {
                      return startAdminConsent();
                    },
                  },
                ]
          }
        />
      </div>

      {isAdminConsentCompleted && (
        <div>
          <Card
            title={cardTitle}
            description={cardDescription}
            buttons={cardButtons}
          />
        </div>
      )}

      {isAdminConsentCompleted &&
        isUserAccountConnected &&
        !BILLING_ENABLED && (
          <div className="mt-6">
            <Card
              title="Action Required: Install App on Microsoft Teams"
              description="If you prefer to install the OneUptime app manually in Microsoft Teams, download the app manifest zip file and follow the instructions below."
              buttons={[
                {
                  title: "Download App Manifest Zip",
                  buttonStyle: SharedButtonStyle.PRIMARY,
                  icon: IconProp.Download,
                  onClick: () => {
                    window.open(
                      `${HOME_URL.toString()}api/microsoft-teams/app-manifest-zip`,
                      "_blank",
                    );
                  },
                },
              ]}
            >
              <MarkdownViewer
                text={`
##### Installation Steps:

Pre-requisite: 
- If you or anyone else in your organization has already installed the OneUptime app in Microsoft Teams, you can skip the installation steps. In this case, you do not need to do anything here.


1. **Download the zip file** using the button above
2. **Upload to Microsoft Teams:**
   - Go to Microsoft Teams → Apps → Manage your apps
   - Click "Upload an app" → "Upload a custom app"
   - Select the downloaded zip file
3. **Install the app:**
   - Find "OneUptime" in your apps
   - Click "Add" to install it for your team
   - Grant the necessary permissions
4. Once the app is installed, you can create workspace notification rules in OneUptime to send messages to your teams.

The zip file contains the app manifest and required icons for Teams installation.
              `}
              />
            </Card>
          </div>
        )}

      {isAdminConsentCompleted && isUserAccountConnected && BILLING_ENABLED && (
        <div className="mt-6">
          <Card
            title="Install OneUptime App from Microsoft Teams Store"
            description="Install the OneUptime app directly from the Microsoft Teams App Store to enable notifications and integrations."
            buttons={[
              {
                title: "Open Teams Store",
                buttonStyle: SharedButtonStyle.PRIMARY,
                icon: IconProp.ExternalLink,
                onClick: () => {
                  window.open(
                    "https://teams.microsoft.com/l/app/" +
                      MicrosoftTeamsAppClientId,
                    "_blank",
                  );
                },
              },
              {
                title: "Download App Manifest for Sideloading",
                buttonStyle: SharedButtonStyle.NORMAL,
                icon: IconProp.Download,
                onClick: () => {
                  window.open(
                    `${HOME_URL.toString()}api/microsoft-teams/app-manifest-zip`,
                    "_blank",
                  );
                },
              },
            ]}
          >
            <MarkdownViewer
              text={`
##### Installation Steps:

1. **Click the button above** to open the OneUptime app in the Microsoft Teams Store
2. **Install the app:**
   - Click "Add" to install it for yourself
   - Or click "Add to a team" to install it for your entire team
   - Grant the necessary permissions
3. Once the app is installed, you can create workspace notification rules in OneUptime to send messages to your teams.

##### Alternative Installation:

You can also search for "OneUptime" in the Microsoft Teams App Store and install it from there.

##### Manual Sideloading (Advanced):

If you prefer to manually sideload the app:
1. Download the app manifest using the "Download App Manifest for Sideloading" button above
2. Go to Microsoft Teams → Apps → Manage your apps
3. Click "Upload an app" → "Upload a custom app"
4. Select the downloaded zip file and follow the installation prompts
              `}
            />
          </Card>
        </div>
      )}

      {isTeamsModalOpen && (
        <TeamsAvailableModal
          isOpen={isTeamsModalOpen}
          onClose={() => {
            return setIsTeamsModalOpen(false);
          }}
          onRefresh={async () => {
            await refreshTeams();
            await loadTeams();
          }}
          isRefreshing={isRefreshTeamsLoading}
          teams={teams}
          isLoading={isTeamsLoading}
          error={teamsError}
          isAdminConsentCompleted={isAdminConsentCompleted}
        />
      )}
    </Fragment>
  );
};

export default MicrosoftTeamsIntegration;
