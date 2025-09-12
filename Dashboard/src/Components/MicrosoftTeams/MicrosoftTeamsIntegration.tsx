import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
} from "react";
import Card from "Common/UI/Components/Card/Card";
import Navigation from "Common/UI/Utils/Navigation";
import URL from "Common/Types/API/URL";
import { APP_API_URL, MicrosoftTeamsAppClientId } from "Common/UI/Config";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import API from "Common/Utils/API";
import HTTPResponse from "Common/Types/API/HTTPResponse";
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
import Button, {
  ButtonStyleType as SharedButtonStyleType,
} from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
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
  placeholder?: string; // Adding a placeholder to satisfy the empty interface rule
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
  const [adminConsentGranted, setAdminConsentGranted] =
    React.useState<boolean>(false);
  const [currentStep, setCurrentStep] = React.useState<string>("admin-consent");
  const [isFinished, setIsFinished] = React.useState<boolean>(false);
  // New persistent finished state that survives reload (derived on load)
  // This indicates the user has explicitly clicked "Finish".
  // Should default to false so we don't skip the Select Team step on first load.
  const [isSetupFinished, setIsSetupFinished] = React.useState<boolean>(true);
  const [isActionLoading, setIsActionLoading] = React.useState<boolean>(false);
  const [showUninstallConfirm, setShowUninstallConfirm] =
    React.useState<boolean>(false);
  const [showRevokeConsentConfirm, setShowRevokeConsentConfirm] =
    React.useState<boolean>(false);

  // Helper: has the user actually selected a concrete team (not placeholder)?
  const isRealTeamSelected: boolean = Boolean(
    currentTeamId && teamsTeamName && teamsTeamName !== "Microsoft Teams",
  );

  // Define the integration steps
  // NOTE: Order changed so that we connect user account before selecting team.
  // We need a user delegated token to list teams; previously this caused the
  // team picker to show an empty state. New order:
  // 1. Admin Consent (project / application permissions)
  // 2. Connect User Account (delegated permissions to enumerate teams)
  // 3. Select Team (auto-select first team by default when fetched)
  const integrationSteps: Array<FormStep<IntegrationFormData>> = [
    {
      id: "admin-consent",
      title: "Step 1: Connect to MS Teams",
    },
    {
      id: "user-account",
      title: "Step 2: Connect User Account",
    },
    {
      id: "select-team",
      title: "Step 3: Select Team",
    },
    {
      id: "finish",
      title: "Step 4: Finish",
    },
  ];

  // Determine current step based on connection status
  const getCurrentStep: () => string = (): string => {
    // Require project-level install first
    if (!isProjectAccountConnected) {
      setIsFinished(false);
      return "admin-consent";
    }
    // Admin consent is optional: if not granted, we still allow proceeding but keep step 1 accessible
    if (!isUserAccountConnected) {
      setIsFinished(false);
      return "user-account";
    }
    if (!isRealTeamSelected) {
      setIsFinished(false);
      return "select-team";
    }
    if (isFinished) {
      setIsFinished(true);
      return "finish";
    }
    return "select-team";
  };

  useEffect(() => {
    setCurrentStep(getCurrentStep());
  }, [
    isProjectAccountConnected,
    isUserAccountConnected,
    adminConsentGranted,
    currentTeamId,
    teamsTeamName,
    isFinished,
    isSetupFinished,
  ]);

  // Derive setup completion whenever all prerequisites are satisfied.
  // This ensures that on page reload we immediately show the management card.
  useEffect(() => {
    const ready: boolean = Boolean(
      MicrosoftTeamsAppClientId &&
        isProjectAccountConnected &&
        adminConsentGranted &&
        isUserAccountConnected &&
        currentTeamId &&
        teamsTeamName &&
        teamsTeamName !== "Microsoft Teams",
    );
    if (!ready) {
      if (!isSetupFinished) {
        setIsSetupFinished(false);
      }
      if (!isFinished) {
        setIsFinished(false);
      }
    }
  }, [
    isProjectAccountConnected,
    adminConsentGranted,
    isUserAccountConnected,
    currentTeamId,
    teamsTeamName,
    currentStep,
    isFinished,
    isSetupFinished,
  ]);

  useEffect(() => {
    if (isProjectAccountConnected && currentTeamId && isUserAccountConnected) {
      props.onConnected();
    } else {
      props.onDisconnected();
    }
  }, [isProjectAccountConnected, currentTeamId, isUserAccountConnected, props]);

  useEffect(() => {
    // Fetch available teams when user account just connected (and project auth present)
    if (
      isUserAccountConnected &&
      userAuthTokenId &&
      isProjectAccountConnected
    ) {
      fetchAvailableTeams().catch((_err: unknown) => {
        // Error logged for debugging - Failed to fetch teams
        setError(<div>Failed to fetch teams</div>);
      });
    }
  }, [isUserAccountConnected, userAuthTokenId, isProjectAccountConnected]);

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
        const miscData: MicrosoftTeamsMiscData = projectAuth.data[0]!
          .miscData! as MicrosoftTeamsMiscData;
        const teamsTeamName: string | undefined = miscData.teamName;
        const teamId: string | undefined = miscData.teamId;
        const adminConsent: boolean = miscData.adminConsentGranted || false;
        setWorkspaceProjectAuthTokenId(projectAuth.data[0]!.id);
        setTeamsTeamName(teamsTeamName || "Microsoft Teams");
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
    if (!userAuthTokenId) {
      return;
    }

    try {
      setIsLoadingTeams(true);
      setError(null);

      const response: HTTPResponse<JSONObject> = await API.post<JSONObject>(
        URL.fromString(APP_API_URL.toString()).addRoute("/teams/get-teams"),
        {
          userAuthTokenId: userAuthTokenId.toString(),
        },
        {
          ...API.getDefaultHeaders(),
        },
      );

      if (
        response.data &&
        (response.data as JSONObject)["teams"] &&
        Array.isArray((response.data as JSONObject)["teams"])
      ) {
        const teamsList: TeamsTeam[] = (response.data as JSONObject)[
          "teams"
        ] as unknown as TeamsTeam[];
        setAvailableTeams(teamsList);
        // Immediate client-side auto-select if none chosen yet
        if (
          teamsList.length > 0 &&
          !currentTeamId &&
          (teamsTeamName === "Microsoft Teams" || !teamsTeamName) &&
          projectAuthTokenId &&
          isUserAccountConnected &&
          isProjectAccountConnected
        ) {
          // Fire and forget
          void selectTeam(teamsList[0]!);
        }
      }
    } catch (error) {
      setError(
        <div>
          Failed to fetch teams:{" "}
          {API.getFriendlyErrorMessage(error as Exception)}
        </div>,
      );
    } finally {
      setIsLoadingTeams(false);
    }
  };

  const selectTeam: (team: TeamsTeam) => Promise<void> = async (
    team: TeamsTeam,
  ): Promise<void> => {
    if (!projectAuthTokenId) {
      return;
    }

    try {
      setIsButtonLoading(true);
      setError(null);

      // Get current misc data to preserve existing values
      const currentAuth: WorkspaceProjectAuthToken | null =
        await ModelAPI.getItem({
          modelType: WorkspaceProjectAuthToken,
          id: projectAuthTokenId,
          select: { miscData: true },
        });

      if (!currentAuth) {
        throw new BadDataException(
          "Could not find project authentication token",
        );
      }

      const currentMiscData: MicrosoftTeamsMiscData =
        (currentAuth.miscData as MicrosoftTeamsMiscData) || {};

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
        <div>
          Failed to select team:{" "}
          {API.getFriendlyErrorMessage(error as Exception)}
        </div>,
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
      const stateData: { projectId: string; userId: string } = {
        projectId: projectId.toString(),
        userId: userId.toString(),
      };
      const stateParam: string = btoa(JSON.stringify(stateData));

      // Use the admin consent endpoint
      const adminConsentUrl: string = `https://login.microsoftonline.com/common/adminconsent?client_id=${MicrosoftTeamsAppClientId}&state=${encodeURIComponent(stateParam)}&redirect_uri=${encodeURIComponent(redirectUri)}`;

      Navigation.navigate(URL.fromString(adminConsentUrl));
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
        "https://graph.microsoft.com/TeamMember.ReadWrite.All",
        "https://graph.microsoft.com/Teamwork.Read.All",
      ];

      const project_install_redirect_uri: string = redirectUri;
      const user_signin_redirect_uri: string = redirectUri;

      // Create state parameter to pass project_id and user_id
      const stateData: { projectId: string; userId: string; authType: string } =
        {
          projectId: projectId.toString(),
          userId: userId.toString(),
          authType: "project",
        };
      const stateParam: string = btoa(JSON.stringify(stateData));

      const userStateData: {
        projectId: string;
        userId: string;
        authType: string;
      } = {
        projectId: projectId.toString(),
        userId: userId.toString(),
        authType: "user",
      };
      const userStateParam: string = btoa(JSON.stringify(userStateData));

      if (!isProjectAccountConnected) {
        // Project-level installation
        const authUrl: string = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${MicrosoftTeamsAppClientId}&response_type=code&redirect_uri=${encodeURIComponent(project_install_redirect_uri)}&scope=${encodeURIComponent(scopes.join(" "))}&state=${encodeURIComponent(stateParam)}&response_mode=query`;
        Navigation.navigate(URL.fromString(authUrl));
      } else {
        const userDelegatedScopes: Array<string> = [
          "openid",
          "profile",
          "offline_access",
          "https://graph.microsoft.com/User.Read",
          "https://graph.microsoft.com/Team.ReadBasic.All",
        ];
        const userAuthUrl: string = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${MicrosoftTeamsAppClientId}&response_type=code&redirect_uri=${encodeURIComponent(user_signin_redirect_uri)}&scope=${encodeURIComponent(userDelegatedScopes.join(" "))}&state=${encodeURIComponent(userStateParam)}&response_mode=query`;
        Navigation.navigate(URL.fromString(userAuthUrl));
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

  useEffect(() => {
    // if this page has a query param with error, then there was an error in authentication.
    const error: string | null = Navigation.getQueryStringByName("error");
    const adminConsent: string | null =
      Navigation.getQueryStringByName("admin_consent");

    if (error) {
      if (error === "admin_consent_denied") {
        setError(
          <div>
            Admin consent was denied. Microsoft Teams integration requires admin
            consent for application permissions to function properly. Please try
            again and grant consent.
          </div>,
        );
      } else {
        setError(
          <div>
            There was an error while connecting with Microsoft Teams. Please try
            again.
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

  // Management actions after finish
  const handleLogoutUser: VoidFunction = async (): Promise<void> => {
    if (!userAuthTokenId) {
      return;
    }
    try {
      setIsActionLoading(true);
      await ModelAPI.deleteItem({
        modelType: WorkspaceUserAuthToken,
        id: userAuthTokenId,
      });
      setIsUserAccountConnected(false);
      setWorkspaceUserAuthTokenId(null);
      setAvailableTeams([]);
      setCurrentTeamId(null); // team tied to user context for channel operations
      setTeamsTeamName("Microsoft Teams");
      setIsFinished(false); // Go back to wizard to reconnect user
      setIsSetupFinished(false);
      setCurrentStep("user-account");
    } catch (err) {
      setError(<div>{API.getFriendlyErrorMessage(err as Exception)}</div>);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleUninstall: () => Promise<void> = async (): Promise<void> => {
    try {
      setIsActionLoading(true);
      // Delete user token first (ignore errors individually)
      if (userAuthTokenId) {
        try {
          await ModelAPI.deleteItem({
            modelType: WorkspaceUserAuthToken,
            id: userAuthTokenId,
          });
        } catch {
          /* ignore */
        }
      }
      if (projectAuthTokenId) {
        try {
          await ModelAPI.deleteItem({
            modelType: WorkspaceProjectAuthToken,
            id: projectAuthTokenId,
          });
        } catch {
          /* ignore */
        }
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
      setIsFinished(false);
      setIsSetupFinished(false);
      setCurrentStep("admin-consent");
    } catch (err) {
      setError(<div>{API.getFriendlyErrorMessage(err as Exception)}</div>);
    } finally {
      setIsActionLoading(false);
    }
  };

  const revokeAdminConsent: () => Promise<void> = async (): Promise<void> => {
    if (!projectAuthTokenId) {
      return;
    }
    try {
      setIsButtonLoading(true);
      setError(null);
      // Delete project token (admin consent / app install)
      await ModelAPI.deleteItem({
        modelType: WorkspaceProjectAuthToken,
        id: projectAuthTokenId,
      });
      // Optionally also clear user token to avoid stale state
      if (userAuthTokenId) {
        try {
          await ModelAPI.deleteItem({
            modelType: WorkspaceUserAuthToken,
            id: userAuthTokenId,
          });
        } catch {
          /* ignore */
        }
        setIsUserAccountConnected(false);
        setWorkspaceUserAuthTokenId(null);
      }
      setIsProjectAccountConnected(false);
      setWorkspaceProjectAuthTokenId(null);
      setAdminConsentGranted(false);
      setCurrentTeamId(null);
      setTeamsTeamName(null);
      setAvailableTeams([]);
      setIsFinished(false);
      setIsSetupFinished(false);
      setCurrentStep("admin-consent");
    } catch (err) {
      setError(<div>{API.getFriendlyErrorMessage(err as Exception)}</div>);
    } finally {
      setIsButtonLoading(false);
    }
  };

  const renderStepContent: () => ReactElement = (): ReactElement => {
    switch (currentStep) {
      case "admin-consent":
        return (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="mb-4">
              <h3 className="text-lg font-medium text-gray-900">
                Step 1: Connect to Microsoft Teams
              </h3>
              <p className="mt-2 text-sm text-gray-600">
                Grant administrative consent (recommended) to enable full
                functionality. If you don&apos;t have admin rights you can still
                proceed with limited delegated permissions by connecting your
                user account after installing the app.
              </p>
              {!adminConsentGranted && isProjectAccountConnected && (
                <p className="mt-2 text-xs text-amber-600">
                  Admin consent not granted. Operating in limited mode – some
                  features may be unavailable until consent is granted.
                </p>
              )}
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                className="md:-ml-3"
                title={
                  isProjectAccountConnected && adminConsentGranted
                    ? "Admin Consent Granted"
                    : "Grant Admin Consent"
                }
                onClick={() => {
                  return initiateAdminConsent();
                }}
                disabled={isProjectAccountConnected && adminConsentGranted}
                icon={
                  isProjectAccountConnected && adminConsentGranted
                    ? IconProp.Check
                    : IconProp.Lock
                }
                buttonStyle={
                  isProjectAccountConnected && adminConsentGranted
                    ? SharedButtonStyleType.SUCCESS
                    : SharedButtonStyleType.PRIMARY
                }
              />
              {isProjectAccountConnected && !adminConsentGranted && (
                <Button
                  title="Continue with Limited Permissions"
                  onClick={() => {
                    return connectWithMicrosoftTeams();
                  }}
                  buttonStyle={SharedButtonStyleType.SECONDARY}
                  icon={IconProp.Refresh}
                />
              )}
              {isProjectAccountConnected && adminConsentGranted && (
                <Button
                  title="Revoke Admin Consent"
                  onClick={() => {
                    return setShowRevokeConsentConfirm(true);
                  }}
                  buttonStyle={SharedButtonStyleType.DANGER_OUTLINE}
                  icon={IconProp.Close}
                  isLoading={isButtonLoading}
                  disabled={isButtonLoading}
                />
              )}
            </div>
          </div>
        );

      case "user-account":
        return (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="mb-4">
                          
              <h3 className="text-lg font-medium text-gray-900">
                Step 2: Connect Your User Account
              </h3>
              <p className="mt-2 text-sm text-gray-600">
                Connect your personal Microsoft Teams account to allow OneUptime
                to list teams and channels for selection in the next step.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                className="md:-ml-3"
                title={
                  isUserAccountConnected
                    ? "Account Connected"
                    : "Connect User Account"
                }
                onClick={() => {
                  return connectWithMicrosoftTeams();
                }}
                disabled={isUserAccountConnected}
                icon={isUserAccountConnected ? IconProp.Check : IconProp.User}
                buttonStyle={
                  isUserAccountConnected
                    ? SharedButtonStyleType.SUCCESS
                    : SharedButtonStyleType.PRIMARY
                }
              />
              {isUserAccountConnected && (
                <Button
                  title="Revoke User Connection"
                  buttonStyle={SharedButtonStyleType.DANGER_OUTLINE}
                  icon={IconProp.Logout}
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
                        setAvailableTeams([]);
                        setCurrentTeamId(null);
                        setTeamsTeamName("Microsoft Teams");
                        // If finished earlier, ensure we go back a step
                        if (isFinished) {
                          setIsFinished(false);
                          setCurrentStep("user-account");
                        }
                      }
                    } catch (error) {
                      setError(
                        <div>
                          {API.getFriendlyErrorMessage(error as Exception)}
                        </div>,
                      );
                    }
                    setIsButtonLoading(false);
                  }}
                  disabled={isButtonLoading}
                />
              )}
            </div>
          </div>
        );

      case "select-team":
        return (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="mb-4">
              <h3 className="text-lg font-medium text-gray-900">
                Step 3: Select Your Team
              </h3>
              <p className="mt-2 text-sm text-gray-600">
                {isRealTeamSelected ? (
                  <span>
                    You&apos;ve selected: <strong>{teamsTeamName}</strong>. You
                    can change your team selection if you like.
                  </span>
                ) : (
                  <span className="text-gray-600">
                    No team selected yet. Please select a Microsoft Teams team
                    below so OneUptime knows where to send notifications.
                  </span>
                )}
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                className="md:-ml-3"
                title={currentTeamId ? "Change Team" : "Select Team"}
                buttonStyle={SharedButtonStyleType.NORMAL}
                icon={IconProp.Settings}
                onClick={() => {
                  if (!isUserAccountConnected) {
                    return;
                  }
                  if (availableTeams.length === 0) {
                    fetchAvailableTeams()
                      .then(() => {
                        return setShowTeamPicker(true);
                      })
                      .catch((err: Exception) => {
                        setError(
                          <div>
                            Failed to fetch teams:{" "}
                            {API.getFriendlyErrorMessage(err)}
                          </div>,
                        );
                      });
                  } else {
                    setShowTeamPicker(true);
                  }
                }}
                disabled={isLoadingTeams || !isUserAccountConnected}
              />
              {isRealTeamSelected && (
                <Button
                  title="Finish"
                  buttonStyle={SharedButtonStyleType.SUCCESS}
                  icon={IconProp.Check}
                  onClick={() => {
                    setIsFinished(true);
                    setIsSetupFinished(true);
                    setCurrentStep("finish");
                  }}
                />
              )}
            </div>
          </div>
        );

      case "finish":
        return (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="mb-4">
              <h3 className="text-lg font-medium text-gray-900">
                Setup Complete
              </h3>
              <p className="mt-2 text-sm text-gray-600">
                Microsoft Teams integration is fully configured for team{" "}
                <strong>{teamsTeamName}</strong>. You can now receive
                notifications and manage settings.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                className="md:-ml-3"
                title="Select Team"
                buttonStyle={SharedButtonStyleType.OUTLINE}
                icon={IconProp.Settings}
                onClick={() => {
                  setIsFinished(false);
                  setIsSetupFinished(false);
                  setCurrentStep("select-team");
                }}
              />
            </div>
          </div>
        );

      default:
        return <div>Unknown step</div>;
    }
  };

  // If setup finished, show management card instead of wizard
  if (
    isSetupFinished &&
    isProjectAccountConnected &&
    isUserAccountConnected &&
    currentTeamId &&
    teamsTeamName &&
    teamsTeamName !== "Microsoft Teams"
  ) {
    return (
      <Fragment>
        <div className="w-full">
          <Card
            title="Microsoft Teams Integration"
            description={`Integration is active for team ${teamsTeamName}. You can manage or uninstall it below.`}
          >
            <div className="space-y-6">
              {/* Edit / Change Team Card */}
              <div className="border rounded-md p-4 bg-gray-50">
                <h4 className="text-sm font-medium text-gray-800 mb-2">
                  Team Selection
                </h4>
                <p className="text-xs text-gray-600 mb-3">
                  Currently connected to: <strong>{teamsTeamName}</strong>.
                  Change the team to direct notifications elsewhere.
                </p>
                <Button
                  className="md:-ml-3"
                  title="Change Team"
                  buttonStyle={SharedButtonStyleType.NORMAL}
                  icon={IconProp.Settings}
                  onClick={() => {
                    if (!isUserAccountConnected) {
                      return;
                    }
                    setShowTeamPicker(true);
                    if (availableTeams.length === 0 && !isLoadingTeams) {
                      fetchAvailableTeams().catch((err: Exception) => {
                        setError(
                          <div>
                            Failed to fetch teams:{" "}
                            {API.getFriendlyErrorMessage(err as Exception)}
                          </div>,
                        );
                      });
                    }
                  }}
                  isLoading={isLoadingTeams}
                  disabled={isLoadingTeams || !isUserAccountConnected}
                />
              </div>
              <div className="border rounded-md p-4 bg-gray-50">
                <h4 className="text-sm font-medium text-gray-800 mb-2">
                  User Session
                </h4>
                <p className="text-xs text-gray-600 mb-3">
                  Log out your personal Microsoft Teams account. Project-level
                  permissions remain until you uninstall.
                </p>
                <Button
                  className="md:-ml-3"
                  title="Log Out of Teams"
                  buttonStyle={SharedButtonStyleType.NORMAL}
                  icon={IconProp.Logout}
                  onClick={() => {
                    void handleLogoutUser();
                  }}
                  isLoading={isActionLoading}
                  disabled={isActionLoading}
                />
              </div>
              <div className="border rounded-md p-4 bg-red-50">
                <h4 className="text-sm font-medium text-red-800 mb-2">
                  Uninstall OneUptime
                </h4>
                <p className="text-xs text-red-700 mb-3">
                  This revokes the integration by deleting stored tokens. (To
                  fully revoke admin consent in Azure AD, remove the Enterprise
                  App manually.)
                </p>
                <Button
                  title="Uninstall Integration"
                  buttonStyle={SharedButtonStyleType.DANGER}
                  icon={IconProp.Trash}
                  onClick={() => {
                    return setShowUninstallConfirm(true);
                  }}
                  isLoading={isActionLoading}
                  disabled={isActionLoading}
                />
              </div>
            </div>
          </Card>
        </div>
        {showTeamPicker && (
          <Modal
            title="Select Microsoft Teams Team"
            description="Choose which Microsoft Teams team to connect to OneUptime"
            isLoading={isLoadingTeams}
            onClose={() => {
              return setShowTeamPicker(false);
            }}
            submitButtonText="Close"
            onSubmit={() => {
              return setShowTeamPicker(false);
            }}
          >
            <div className="space-y-3">
              {isLoadingTeams && <PageLoader isVisible={true} />}
              {!isLoadingTeams && availableTeams.length === 0 && (
                <div className="text-center py-4 text-gray-500">
                  No teams found. Please ensure you&apos;re a member of at least
                  one Microsoft Teams team.
                </div>
              )}
              {!isLoadingTeams &&
                availableTeams.map((team: TeamsTeam) => {
                  return (
                    <div
                      key={team.id}
                      className={`border rounded-lg p-4 cursor-pointer hover:bg-gray-50 transition-colors ${
                        currentTeamId === team.id
                          ? "border-blue-500 bg-blue-50"
                          : "border-gray-200"
                      }`}
                      onClick={() => {
                        return selectTeam(team);
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-lg font-medium text-gray-900">
                            {team.displayName}
                          </h3>
                          {team.description && (
                            <p className="text-sm text-gray-500 mt-1">
                              {team.description}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center space-x-2">
                          {currentTeamId === team.id && (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                              Current
                            </span>
                          )}
                          <Button
                            title={
                              currentTeamId === team.id ? "Selected" : "Select"
                            }
                            buttonStyle={
                              currentTeamId === team.id
                                ? SharedButtonStyleType.SUCCESS
                                : SharedButtonStyleType.PRIMARY
                            }
                            onClick={() => {
                              return selectTeam(team);
                            }}
                            isLoading={isButtonLoading}
                            disabled={currentTeamId === team.id}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </Modal>
        )}
        {showUninstallConfirm && (
          <ConfirmModal
            title="Uninstall Microsoft Teams Integration"
            description={
              <div className="space-y-3 text-sm">
                <p>
                  This will remove both project-level and user-level tokens
                  stored in OneUptime for Microsoft Teams.
                </p>
                <p className="text-red-600 font-medium">
                  This action cannot be undone inside OneUptime.
                </p>
                <p className="text-xs text-gray-500">
                  If you also want to fully revoke granted permissions in Azure
                  AD, remove the Enterprise Application from your Azure portal
                  after uninstalling.
                </p>
              </div>
            }
            submitButtonText="Uninstall"
            submitButtonType={SharedButtonStyleType.DANGER}
            onSubmit={async () => {
              await handleUninstall();
              setShowUninstallConfirm(false);
            }}
            onClose={() => {
              return setShowUninstallConfirm(false);
            }}
            disableSubmitButton={isActionLoading}
            isLoading={isActionLoading}
          />
        )}
      </Fragment>
    );
  }

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
              <div className="bg-gray-50 rounded-lg p-6 border border-gray-200">
                <h3 className="text-lg font-medium text-gray-900 mb-4">
                  Setup Progress
                </h3>
                <Steps<IntegrationFormData>
                  steps={integrationSteps}
                  currentFormStepId={currentStep}
                  onClick={(step: FormStep<IntegrationFormData>) => {
                    // Allow navigation to completed steps
                    const stepIndex: number = integrationSteps.findIndex(
                      (s: FormStep<IntegrationFormData>) => {
                        return s.id === step.id;
                      },
                    );
                    const currentIndex: number = integrationSteps.findIndex(
                      (s: FormStep<IntegrationFormData>) => {
                        return s.id === currentStep;
                      },
                    );
                    if (stepIndex <= currentIndex) {
                      setCurrentStep(step.id);
                    }
                  }}
                  formValues={{} as FormValues<IntegrationFormData>}
                />
              </div>
            </aside>

            {/* Main content */}
            <div className="lg:col-span-8">{renderStepContent()}</div>
          </div>
        </Card>
      </div>

      {showTeamPicker && (
        <Modal
          title="Select Microsoft Teams Team"
          description="Choose which Microsoft Teams team to connect to OneUptime"
          isLoading={isLoadingTeams}
          onClose={() => {
            return setShowTeamPicker(false);
          }}
          submitButtonText="Close"
          onSubmit={() => {
            return setShowTeamPicker(false);
          }}
        >
          <div className="space-y-3">
            {isLoadingTeams && <PageLoader isVisible={true} />}
            {!isLoadingTeams && availableTeams.length === 0 && (
              <div className="text-center py-4 text-gray-500">
                No teams found. Please ensure you&apos;re a member of at least
                one Microsoft Teams team.
              </div>
            )}
            {!isLoadingTeams &&
              availableTeams.map((team: TeamsTeam) => {
                return (
                  <div
                    key={team.id}
                    className={`border rounded-lg p-4 cursor-pointer hover:bg-gray-50 transition-colors ${
                      currentTeamId === team.id
                        ? "border-blue-500 bg-blue-50"
                        : "border-gray-200"
                    }`}
                    onClick={() => {
                      return selectTeam(team);
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-medium text-gray-900">
                          {team.displayName}
                        </h3>
                        {team.description && (
                          <p className="text-sm text-gray-500 mt-1">
                            {team.description}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center space-x-2">
                        {currentTeamId === team.id && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                            Current
                          </span>
                        )}
                        <Button
                          title={
                            currentTeamId === team.id ? "Selected" : "Select"
                          }
                          buttonStyle={
                            currentTeamId === team.id
                              ? SharedButtonStyleType.SUCCESS
                              : SharedButtonStyleType.PRIMARY
                          }
                          onClick={() => {
                            return selectTeam(team);
                          }}
                          isLoading={isButtonLoading}
                          disabled={currentTeamId === team.id}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </Modal>
      )}

      {showRevokeConsentConfirm && (
        <ConfirmModal
          title="Revoke Admin Consent"
          description={
            <div className="space-y-3 text-sm">
              <p>
                This will remove the project-level Microsoft Teams authorization
                (admin consent) from OneUptime.
              </p>
              <p className="text-red-600 font-medium">
                User tokens and selected team will also be cleared.
              </p>
              <p className="text-xs text-gray-500">
                To fully revoke permissions in Azure AD, you may still need to
                remove the Enterprise Application manually.
              </p>
            </div>
          }
          submitButtonText="Revoke"
          submitButtonType={SharedButtonStyleType.DANGER}
          onSubmit={async () => {
            await revokeAdminConsent();
            setShowRevokeConsentConfirm(false);
          }}
          onClose={() => {
            return setShowRevokeConsentConfirm(false);
          }}
          disableSubmitButton={isButtonLoading}
          isLoading={isButtonLoading}
        />
      )}
    </Fragment>
  );
};

export default MicrosoftTeamsIntegration;
