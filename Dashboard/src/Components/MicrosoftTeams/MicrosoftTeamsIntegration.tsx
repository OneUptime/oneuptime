import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
} from "react";
import Card from "Common/UI/Components/Card/Card";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
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
import Steps from "Common/UI/Components/Forms/Steps/Steps";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import GenericObject from "Common/Types/GenericObject";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";

export interface ComponentProps {
  onConnected: VoidFunction;
  onDisconnected: VoidFunction;
}

export interface TeamsTeam {
  id: string;
  displayName: string;
  description?: string;
}

interface IntegrationFormData extends GenericObject {
  // This is just for the steps component, we don't actually use form data
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
  const [adminConsentGranted, setAdminConsentGranted] = React.useState<boolean>(false);
  const [currentStep, setCurrentStep] = React.useState<string>("admin-consent");

  // Define the integration steps
  const integrationSteps: Array<FormStep<IntegrationFormData>> = [
    {
      id: "admin-consent",
      title: "Connect to MS Teams",
    },
    {
      id: "select-team",
      title: "Select Team",
    },
    {
      id: "user-account",
      title: "Connect User Account",
    },
  ];

  // Determine current step based on connection status
  const getCurrentStep = (): string => {
    if (!isProjectAccountConnected || !adminConsentGranted) {
      return "admin-consent";
    } else if (!currentTeamId || teamsTeamName === 'Microsoft Teams') {
      return "select-team";
    } else if (!isUserAccountConnected) {
      return "user-account";
    } else {
      return "user-account"; // All steps completed, show user account as final step
    }
  };

  useEffect(() => {
    setCurrentStep(getCurrentStep());
  }, [isProjectAccountConnected, isUserAccountConnected, adminConsentGranted, currentTeamId, teamsTeamName]);

  useEffect(() => {
    if (isProjectAccountConnected && currentTeamId && isUserAccountConnected) {
      props.onConnected();
    } else {
      props.onDisconnected();
    }
  }, [isProjectAccountConnected, currentTeamId, isUserAccountConnected, props]);

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
        const adminConsent: boolean = miscData.adminConsentGranted || false;
        setWorkspaceProjectAuthTokenId(projectAuth.data[0]!.id);
        setTeamsTeamName(teamsTeamName || 'Microsoft Teams');
        setCurrentTeamId(teamId || null);
        setAdminConsentGranted(adminConsent);
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

  const initiateAdminConsent: VoidFunction = (): void => {
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

      const redirectUri: string = `${APP_API_URL}/teams/admin-consent`;

      // Create state parameter for admin consent
      const stateData = {
        projectId: projectId.toString(),
        userId: userId.toString(),
      };
      const stateParam = btoa(JSON.stringify(stateData));

      // Use the admin consent endpoint
      const adminConsentUrl = `https://login.microsoftonline.com/common/adminconsent?client_id=${MicrosoftTeamsAppClientId}&state=${encodeURIComponent(stateParam)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
      
      Navigation.navigate(URL.fromString(adminConsentUrl));
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

      const scopes: Array<string> = [
        "openid",
        "profile",
        "offline_access",
        "email",
        "https://graph.microsoft.com/User.Read",
        "https://graph.microsoft.com/Team.ReadBasic.All",
        "https://graph.microsoft.com/Channel.ReadBasic.All",
        "https://graph.microsoft.com/ChannelMessage.Send",
        "https://graph.microsoft.com/TeamMember.ReadWrite.All",
        "https://graph.microsoft.com/Teamwork.Read.All"
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
        const userDelegatedScopes: Array<string> = [
          "openid",
          "profile",
          "offline_access",
          "https://graph.microsoft.com/User.Read",
          "https://graph.microsoft.com/Team.ReadBasic.All"
        ];
        const userAuthUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${MicrosoftTeamsAppClientId}&response_type=code&redirect_uri=${encodeURIComponent(user_signin_redirect_uri)}&scope=${encodeURIComponent(userDelegatedScopes.join(" "))}&state=${encodeURIComponent(userStateParam)}&response_mode=query`;
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

  useEffect(() => {
    // if this page has a query param with error, then there was an error in authentication.
    const error: string | null = Navigation.getQueryStringByName("error");
    const adminConsent: string | null = Navigation.getQueryStringByName("admin_consent");

    if (error) {
      if (error === "admin_consent_denied") {
        setError(
          <div>
            Admin consent was denied. Microsoft Teams integration requires admin consent 
            for application permissions to function properly. Please try again and grant consent.
          </div>,
        );
      } else {
        setError(
          <div>
            There was an error while connecting with Microsoft Teams. Please try again.
          </div>,
        );
      }
      return;
    }

    if (adminConsent === "granted") {
      // Admin consent was granted, reload the items to update the UI
      loadItems().catch((error: Exception) => {
        setError(<div>{API.getFriendlyErrorMessage(error)}</div>);
      });
      return;
    }

    loadItems().catch((error: Exception) => {
      setError(<div>{API.getFriendlyErrorMessage(error)}</div>);
    });
  }, []);

  if (!MicrosoftTeamsAppClientId) {
    return <MicrosoftTeamsIntegrationDocumentation manifest={{}} />;
  }

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  const renderStepContent = (): ReactElement => {
    switch (currentStep) {
      case "admin-consent":
        return (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="mb-4">
              <h3 className="text-lg font-medium text-gray-900">Step 1: Connect to Microsoft Teams</h3>
              <p className="mt-2 text-sm text-gray-600">
                First, grant administrative consent to allow OneUptime to integrate with your Microsoft Teams workspace. This step requires admin privileges.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                className={`inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white ${
                  isProjectAccountConnected && adminConsentGranted 
                    ? 'bg-green-600 hover:bg-green-700' 
                    : 'bg-indigo-600 hover:bg-indigo-700'
                } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500`}
                onClick={() => initiateAdminConsent()}
                disabled={isProjectAccountConnected && adminConsentGranted}
              >
                {isProjectAccountConnected && adminConsentGranted ? (
                  <>
                    <svg className="mr-2 h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    Admin Consent Granted
                  </>
                ) : (
                  <>
                    <svg className="mr-2 h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                    </svg>
                    Grant Admin Consent
                  </>
                )}
              </button>
              {isProjectAccountConnected && !adminConsentGranted && (
                <button
                  className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                  onClick={() => connectWithMicrosoftTeams()}
                >
                  <svg className="mr-2 h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
                  </svg>
                  Continue with Limited Permissions
                </button>
              )}
            </div>
          </div>
        );
      
      case "select-team":
        return (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="mb-4">
              <h3 className="text-lg font-medium text-gray-900">Step 2: Select Your Team</h3>
              <p className="mt-2 text-sm text-gray-600">
                {currentTeamId ? 
                  `You've selected: ${teamsTeamName}. You can change your team selection or proceed to connect your user account.` : 
                  "Choose which Microsoft Teams team you want to connect to OneUptime for receiving notifications."
                }
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
                onClick={() => {
                  if (availableTeams.length === 0) {
                    fetchAvailableTeams().then(() => setShowTeamPicker(true)).catch((err) => {
                      setError(<div>Failed to fetch teams: {API.getFriendlyErrorMessage(err)}</div>);
                    });
                  } else {
                    setShowTeamPicker(true);
                  }
                }}
                disabled={isLoadingTeams}
              >
                <svg className="mr-2 h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
                </svg>
                {currentTeamId ? "Change Team" : "Select Team"}
              </button>
              {isProjectAccountConnected && (
                <button
                  className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-red-700 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50"
                  onClick={async () => {
                    try {
                      setIsButtonLoading(true);
                      setError(null);
                      
                      // Disconnect both user and project tokens
                      if (userAuthTokenId) {
                        await ModelAPI.deleteItem({
                          modelType: WorkspaceUserAuthToken,
                          id: userAuthTokenId,
                        });
                      }
                      
                      if (projectAuthTokenId) {
                        await ModelAPI.deleteItem({
                          modelType: WorkspaceProjectAuthToken,
                          id: projectAuthTokenId,
                        });
                      }
                      
                      // Reset all state
                      setIsUserAccountConnected(false);
                      setIsProjectAccountConnected(false);
                      setWorkspaceUserAuthTokenId(null);
                      setWorkspaceProjectAuthTokenId(null);
                      setCurrentTeamId(null);
                      setTeamsTeamName(null);
                      setAdminConsentGranted(false);
                      setAvailableTeams([]);
                    } catch (error) {
                      setError(<div>{API.getFriendlyErrorMessage(error as Exception)}</div>);
                    }
                    setIsButtonLoading(false);
                  }}
                  disabled={isButtonLoading}
                >
                  <svg className="mr-2 h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" clipRule="evenodd" />
                    <path fillRule="evenodd" d="M4 5a2 2 0 012-2h8a2 2 0 012 2v6a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 2a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
                  </svg>
                  Disconnect Integration
                </button>
              )}
            </div>
          </div>
        );

      case "user-account":
        return (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="mb-4">
              <h3 className="text-lg font-medium text-gray-900">Step 3: Connect Your User Account</h3>
              <p className="mt-2 text-sm text-gray-600">
                Connect your personal Microsoft Teams account to allow OneUptime to access your teams and channels.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                className={`inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white ${
                  isUserAccountConnected 
                    ? 'bg-green-600 hover:bg-green-700' 
                    : 'bg-indigo-600 hover:bg-indigo-700'
                } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500`}
                onClick={() => connectWithMicrosoftTeams()}
                disabled={isUserAccountConnected}
              >
                {isUserAccountConnected ? (
                  <>
                    <svg className="mr-2 h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    Account Connected
                  </>
                ) : (
                  <>
                    <svg className="mr-2 h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
                    </svg>
                    Connect User Account
                  </>
                )}
              </button>
              {isUserAccountConnected && (
                <button
                  className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50"
                  onClick={async () => {
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
                      }
                    } catch (error) {
                      setError(<div>{API.getFriendlyErrorMessage(error as Exception)}</div>);
                    }
                    setIsButtonLoading(false);
                  }}
                  disabled={isButtonLoading}
                >
                  <svg className="mr-2 h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                  Disconnect Account
                </button>
              )}
            </div>
          </div>
        );
      
      default:
        return <div>Unknown step</div>;
    }
  };

  return (
    <Fragment>
      <div className="w-full">
        <Card
          title="Microsoft Teams Integration Setup"
          description="Follow these simple steps to connect your Microsoft Teams workspace with OneUptime."
        >
          <div className="lg:grid lg:grid-cols-12 lg:gap-x-8">
            {/* Steps sidebar */}
            <aside className="lg:col-span-4 mb-8 lg:mb-0">
              <div className="bg-gray-50 rounded-lg p-6 ring ring-1 ring-gray-200">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Setup Progress</h3>
                <Steps<IntegrationFormData>
                  steps={integrationSteps}
                  currentFormStepId={currentStep}
                  onClick={(step: FormStep<IntegrationFormData>) => {
                    // Allow navigation to completed steps
                    const stepIndex = integrationSteps.findIndex(s => s.id === step.id);
                    const currentIndex = integrationSteps.findIndex(s => s.id === currentStep);
                    if (stepIndex <= currentIndex) {
                      setCurrentStep(step.id);
                    }
                  }}
                  formValues={{} as FormValues<IntegrationFormData>}
                />
              </div>
            </aside>

            {/* Main content */}
            <div className="lg:col-span-8">
              {renderStepContent()}
            </div>
          </div>
        </Card>
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
