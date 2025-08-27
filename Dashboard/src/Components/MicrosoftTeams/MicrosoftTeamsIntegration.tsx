import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
} from "react";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import Navigation from "Common/UI/Utils/Navigation";
import URL from "Common/Types/API/URL";
import { APP_API_URL, MicrosoftTeamsAppClientId } from "Common/UI/Config";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import API from "Common/Utils/API";
import Exception from "Common/Types/Exception/Exception";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import WorkspaceProjectAuthToken, {
  MicrosoftTeamsMiscData,
} from "Common/Models/DatabaseModels/WorkspaceProjectAuthToken";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import WorkspaceUserAuthToken from "Common/Models/DatabaseModels/WorkspaceUserAuthToken";
import { PromiseVoidFunction, VoidFunction } from "Common/Types/FunctionTypes";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import MicrosoftTeamsIntegrationDocumentation from "./MicrosoftTeamsIntegrationDocumentation";
import Link from "Common/UI/Components/Link/Link";
import { JSONObject } from "Common/Types/JSON";
import BadDataException from "Common/Types/Exception/BadDataException";
import Modal from "Common/UI/Components/Modal/Modal";
import Button from "Common/UI/Components/Button/Button";

export interface ComponentProps {
  onConnected: VoidFunction;
  onDisconnected: VoidFunction;
}

export interface TeamsTeam {
  id: string;
  displayName: string;
  description?: string;
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
  const [teamsTeamName, setTeamsTeamName] = React.useState<string | null>(null);
  const [currentTeamId, setCurrentTeamId] = React.useState<string | null>(null);
  const [availableTeams, setAvailableTeams] = React.useState<TeamsTeam[]>([]);
  const [showTeamPicker, setShowTeamPicker] = React.useState<boolean>(false);
  const [isLoadingTeams, setIsLoadingTeams] = React.useState<boolean>(false);

  useEffect(() => {
    if (isProjectAccountConnected) {
      props.onConnected();
    } else {
      props.onDisconnected();
    }
  }, [isProjectAccountConnected, props]);

  useEffect(() => {
    // Fetch available teams when user is connected
    if (isUserAccountConnected && userAuthTokenId) {
      fetchAvailableTeams().catch((err) => {
        console.error("Failed to fetch teams:", err);
      });
    }
  }, [isUserAccountConnected, userAuthTokenId]);

  // If project is connected but no specific team chosen (generic placeholder) and teams are loaded, prompt user to pick.
  useEffect(() => {
    if (
      isProjectAccountConnected &&
      isUserAccountConnected &&
      teamsTeamName === 'Microsoft Teams' &&
      !currentTeamId &&
      availableTeams.length > 0 &&
      !showTeamPicker
    ) {
      setShowTeamPicker(true);
    }
  }, [
    isProjectAccountConnected,
    isUserAccountConnected,
    teamsTeamName,
    currentTeamId,
    availableTeams,
    showTeamPicker,
  ]);

  const loadItems: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setError(null);
      setIsLoading(true);

      // check if the project is already connected with Teams.
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
          },
          limit: 1,
          skip: 0,
          sort: {
            createdAt: SortOrder.Descending,
          },
        });

      if (projectAuth.data.length > 0) {
        setIsProjectAccountConnected(true);
        const miscData = projectAuth.data[0]!.miscData! as MicrosoftTeamsMiscData;
        const teamsTeamName: string | undefined = miscData.teamName;
        const teamId: string | undefined = miscData.teamId;
        setWorkspaceProjectAuthTokenId(projectAuth.data[0]!.id);
        setTeamsTeamName(teamsTeamName || 'Microsoft Teams');
        setCurrentTeamId(teamId || null);
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

  const fetchAvailableTeams: PromiseVoidFunction = async (): Promise<void> => {
    if (!userAuthTokenId) return;
    
    try {
      setIsLoadingTeams(true);
      setError(null);
      
      const response = await API.post<JSONObject>(
        URL.fromString(APP_API_URL.toString()).addRoute("/teams/get-teams"),
        {
          userAuthTokenId: userAuthTokenId.toString(),
        },
        {
          ...API.getDefaultHeaders(),
        }
      );

      if (response.data && (response.data as JSONObject)["teams"] && Array.isArray((response.data as JSONObject)["teams"])) {
        setAvailableTeams(((response.data as JSONObject)["teams"] as unknown) as TeamsTeam[]);
      }
    } catch (error) {
      setError(
        <div>Failed to fetch teams: {API.getFriendlyErrorMessage(error as Exception)}</div>
      );
    } finally {
      setIsLoadingTeams(false);
    }
  };

  const selectTeam = async (team: TeamsTeam): Promise<void> => {
    if (!projectAuthTokenId) return;
    
    try {
      setIsButtonLoading(true);
      setError(null);

      // Get current misc data to preserve existing values
      const currentAuth = await ModelAPI.getItem({
        modelType: WorkspaceProjectAuthToken,
        id: projectAuthTokenId,
        select: { miscData: true },
      });

      if (!currentAuth) {
        throw new BadDataException("Could not find project authentication token");
      }

      const currentMiscData = (currentAuth.miscData as MicrosoftTeamsMiscData) || {};
      
      // Update the project auth token with the selected team
      const updatedMiscData: MicrosoftTeamsMiscData = {
        ...currentMiscData,
        teamId: team.id,
        teamName: team.displayName,
        tenantId: currentMiscData.tenantId || "common", // Preserve existing tenantId or use default
      };

      await ModelAPI.updateById({
        modelType: WorkspaceProjectAuthToken,
        id: projectAuthTokenId,
        data: {
          miscData: updatedMiscData,
        },
      });

      setCurrentTeamId(team.id);
      setTeamsTeamName(team.displayName);
      setShowTeamPicker(false);
    } catch (error) {
      setError(
        <div>Failed to select team: {API.getFriendlyErrorMessage(error as Exception)}</div>
      );
    } finally {
      setIsButtonLoading(false);
    }
  };

  useEffect(() => {
    // if this page has a query param with error, then there was an error in authentication.
    const error: string | null = Navigation.getQueryStringByName("error");

    if (error) {
      setError(
        <div>
          There was an error while connecting with Microsoft Teams. Please try again.
        </div>,
      );
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

  // if user and project both connected with Teams
  if (isUserAccountConnected && isProjectAccountConnected) {
    cardTitle = `You are connected with ${teamsTeamName} on Microsoft Teams`;
    cardDescription = `Your account is already connected with Microsoft Teams.`;
    cardButtons = [
      {
        title: `Change Team`,
        isLoading: isButtonLoading,
        buttonStyle: ButtonStyleType.NORMAL,
        onClick: async () => {
          setShowTeamPicker(true);
        },
        icon: IconProp.Settings,
      },
      {
        title: `Disconnect`,
        isLoading: isButtonLoading,
        buttonStyle: ButtonStyleType.DANGER,
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

  const connectWithMicrosoftTeams: VoidFunction = (): void => {
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

      const redirectUri: string = `${APP_API_URL}/teams/auth`;

      // Delegated scopes for Teams integration (requested via user authorization).
      // NOTE: Application (app-only) permissions like Channel.Create, Channel.Delete.All, etc.
      // are granted via admin consent in Azure AD and are NOT added to this delegated scope list.
      // Some advanced permissions may not have delegated equivalents; adding them here will cause
      // Azure AD to reject the authorization request. Only include those that are valid delegated scopes.
      const scopes: Array<string> = [
        "https://graph.microsoft.com/User.Read",                // basic profile
        "https://graph.microsoft.com/Team.ReadBasic.All",       // list teams
        "https://graph.microsoft.com/Channel.ReadBasic.All",    // list channels
        "https://graph.microsoft.com/ChannelMessage.Send",      // send messages
        "https://graph.microsoft.com/TeamMember.ReadWrite.All", // (optional) manage membership
        // Optional: read channel messages if product features need it
        "https://graph.microsoft.com/ChannelMessage.Read.All"    // (optional) read messages
      ];

      const project_install_redirect_uri: string = redirectUri;
      const user_signin_redirect_uri: string = redirectUri;

      // Create state parameter to pass project_id and user_id
      const stateData = {
        projectId: projectId.toString(),
        userId: userId.toString(),
        authType: 'project'
      };
      const stateParam = btoa(JSON.stringify(stateData));

      const userStateData = {
        projectId: projectId.toString(),
        userId: userId.toString(),
        authType: 'user'
      };
      const userStateParam = btoa(JSON.stringify(userStateData));

      if (!isProjectAccountConnected) {
        // Project-level installation
        const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${MicrosoftTeamsAppClientId}&response_type=code&redirect_uri=${encodeURIComponent(project_install_redirect_uri)}&scope=${encodeURIComponent(scopes.join(" "))}&state=${encodeURIComponent(stateParam)}&response_mode=query`;
        Navigation.navigate(URL.fromString(authUrl));
      } else {
        // User-level authentication only  
        const userAuthUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${MicrosoftTeamsAppClientId}&response_type=code&redirect_uri=${encodeURIComponent(user_signin_redirect_uri)}&scope=${encodeURIComponent(["https://graph.microsoft.com/User.Read"].join(" "))}&state=${encodeURIComponent(userStateParam)}&response_mode=query`;
        Navigation.navigate(URL.fromString(userAuthUrl));
      }
    } else {
      setError(
        <div>
          Looks like the Microsoft Teams App Client ID is not set in the environment
          variables when you installed OneUptime. For more information, please
          check this guide to set up Microsoft Teams App properly:{" "}
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
      buttonStyle: ButtonStyleType.PRIMARY,
      onClick: () => {
        return connectWithMicrosoftTeams();
      },
      icon: IconProp.MicrosoftTeams,
    };
  };

  // if user is not connected and the project is connected with Teams
  if (!isUserAccountConnected && isProjectAccountConnected) {
    cardTitle = `You are disconnected from Microsoft Teams (but OneUptime is already installed in ${teamsTeamName})`;
    cardDescription = `Connect your account with Microsoft Teams to make the most out of OneUptime.`;
    cardButtons = [
      getConnectWithTeamsButton(`Connect my account with Microsoft Teams`),
      {
        title: `Uninstall OneUptime from Microsoft Teams`,
        isLoading: isButtonLoading,
        buttonStyle: ButtonStyleType.DANGER,
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
              setWorkspaceProjectAuthTokenId(null);
            } else {
              setError(
                <div>
                  Looks like the project auth token id is not set properly. Please
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
        icon: IconProp.Trash,
      },
    ];
  }

  if (!isProjectAccountConnected) {
    cardTitle = `Connect with Microsoft Teams`;
    cardDescription = `Connect your account with Microsoft Teams to make the most out of OneUptime.`;
    cardButtons = [getConnectWithTeamsButton(`Connect with Microsoft Teams`)];
  }

  if (!MicrosoftTeamsAppClientId) {
    return <MicrosoftTeamsIntegrationDocumentation manifest={{}} />;
  }

  return (
    <Fragment>
      <div>
        <Card
          title={cardTitle}
          description={cardDescription}
          buttons={cardButtons}
        />
      </div>
      
      {showTeamPicker && (
        <Modal
          title="Select Microsoft Teams Team"
          description="Choose which Microsoft Teams team to connect to OneUptime"
          isLoading={isLoadingTeams}
          onClose={() => setShowTeamPicker(false)}
          submitButtonText="Close"
          onSubmit={() => setShowTeamPicker(false)}
        >
          <div className="space-y-3">
            {isLoadingTeams && <PageLoader isVisible={true} />}
            {!isLoadingTeams && availableTeams.length === 0 && (
              <div className="text-center py-4 text-gray-500">
                No teams found. Please ensure you're a member of at least one Microsoft Teams team.
              </div>
            )}
            {!isLoadingTeams && availableTeams.map((team) => (
              <div
                key={team.id}
                className={`border rounded-lg p-4 cursor-pointer hover:bg-gray-50 transition-colors ${
                  currentTeamId === team.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                }`}
                onClick={() => selectTeam(team)}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-medium text-gray-900">{team.displayName}</h3>
                    {team.description && (
                      <p className="text-sm text-gray-500 mt-1">{team.description}</p>
                    )}
                  </div>
                  <div className="flex items-center space-x-2">
                    {currentTeamId === team.id && (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        Current
                      </span>
                    )}
                    <Button
                      title={currentTeamId === team.id ? "Selected" : "Select"}
                      buttonStyle={currentTeamId === team.id ? ButtonStyleType.SUCCESS : ButtonStyleType.PRIMARY}
                      onClick={() => selectTeam(team)}
                      isLoading={isButtonLoading}
                      disabled={currentTeamId === team.id}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </Fragment>
  );
};

export default MicrosoftTeamsIntegration;
