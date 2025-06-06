import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
} from "react";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import URL from "Common/Types/API/URL";
import { APP_API_URL, MicrosoftTeamsAppClientId } from "Common/UI/Config";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import Exception from "Common/Types/Exception/Exception";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import HTTPResponse from "Common/Types/API/HTTPResponse";
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

export interface ComponentProps {
  onConnected: VoidFunction;
  onDisconnected: VoidFunction;
}

const MicrosoftTeamsIntegration: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [error, setError] = React.useState<ReactElement | null>(null);
  const [isLoading, setIsLoading] = React.useState<boolean>(true);
  const [manifest, setManifest] = React.useState<JSONObject | null>(null);
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

      // Always fetch app manifest (even if client ID is not set yet)
      // Users need to see this manifest to create their Microsoft Teams app
      const manifestResponse: HTTPResponse<JSONObject> = await API.get(
        URL.fromString(APP_API_URL.toString()).addRoute(
          new Route("/api/microsoft-teams/app-manifest"),
        ),
      );

      if (manifestResponse.isSuccess()) {
        setManifest(manifestResponse.data);
      }

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
          },
          limit: 1,
          skip: 0,
          sort: {
            createdAt: SortOrder.Descending,
          },
        });

      if (projectAuth.data.length > 0) {
        setIsProjectAccountConnected(true);
        const teamsTeamName: string | undefined = (
          projectAuth.data[0]!.miscData! as MicrosoftTeamsMiscData
        ).teamName;
        setWorkspaceProjectAuthTokenId(projectAuth.data[0]!.id);
        setTeamsTeamName(teamsTeamName);
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

  useEffect(() => {
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
    cardTitle = `You are connected with ${teamsTeamName} team on Microsoft Teams`;
    cardDescription = `Your account is already connected with Microsoft Teams.`;
    cardButtons = [
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

  // if user is not connected and the project is connected with Microsoft Teams.
  if (!isUserAccountConnected && isProjectAccountConnected) {
    cardTitle = `You are disconnected from Microsoft Teams (but OneUptime is already installed in ${teamsTeamName} team)`;
    cardDescription = `Connect your account with Microsoft Teams to make the most out of OneUptime.`;
    cardButtons = [
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
    cardDescription = `Connect your Microsoft Teams workspace with OneUptime to get notified about incidents, alerts, and more.`;
    
    if (MicrosoftTeamsAppClientId) {
      const project_install_redirect_uri: string = encodeURIComponent(
        `${APP_API_URL.toString()}/api/microsoft-teams/auth/${ProjectUtil.getCurrentProjectId()?.toString()}/${UserUtil.getUserId()?.toString()}`,
      );

      cardButtons = [
        {
          title: `Connect to Microsoft Teams`,
          buttonStyle: ButtonStyleType.PRIMARY,
          onClick: () => {
            window.location.href = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${MicrosoftTeamsAppClientId}&response_type=code&redirect_uri=${project_install_redirect_uri}&scope=https://graph.microsoft.com/Team.ReadBasic.All https://graph.microsoft.com/User.Read&state=${Buffer.from(JSON.stringify({ projectId: ProjectUtil.getCurrentProjectId()?.toString(), userId: UserUtil.getUserId()?.toString() })).toString('base64')}`;
          },
          icon: IconProp.Add,
        },
      ];
    } else {
      cardButtons = [
        {
          title: `Learn More About Microsoft Teams Integration`,
          buttonStyle: ButtonStyleType.PRIMARY,
          onClick: () => {
            window.open('https://docs.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook', '_blank');
          },
          icon: IconProp.ExternalLink,
        },
      ];
    }
  }

  if (!MicrosoftTeamsAppClientId || MicrosoftTeamsAppClientId === 'YOUR_MICROSOFT_TEAMS_APP_CLIENT_ID') {
    return (
      <MicrosoftTeamsIntegrationDocumentation
        manifest={manifest || {}}
      />
    );
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
    </Fragment>
  );
};

export default MicrosoftTeamsIntegration;
