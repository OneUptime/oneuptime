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
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import MicrosoftTeamsIntegrationDocumentation from "./MicrosoftTeamsIntegrationDocumentation";
import Link from "Common/UI/Components/Link/Link";

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
  const [teamsTeamName, setTeamsTeamName] = React.useState<string | null>(null);

  useEffect(() => {
    if (isProjectAccountConnected) {
      props.onConnected();
    } else {
      props.onDisconnected();
    }
  }, [isProjectAccountConnected, props]);

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
        const teamsTeamName: string | undefined = (
          projectAuth.data[0]!.miscData! as MicrosoftTeamsMiscData
        ).teamName;
        setWorkspaceProjectAuthTokenId(projectAuth.data[0]!.id);
        setTeamsTeamName(teamsTeamName || 'Microsoft Teams');
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

      const redirectUri: string = `${APP_API_URL}/teams/auth/${projectId.toString()}/${userId.toString()}`;

      // Required scopes for Teams integration
      const scopes: Array<string> = [
        "https://graph.microsoft.com/Team.ReadBasic.All",
        "https://graph.microsoft.com/Channel.ReadBasic.All", 
        "https://graph.microsoft.com/ChannelMessage.Send",
        "https://graph.microsoft.com/User.Read",
        "https://graph.microsoft.com/TeamMember.ReadWrite.All"
      ];

      const project_install_redirect_uri: string = redirectUri;
      const user_signin_redirect_uri: string = `${APP_API_URL}/teams/auth/${projectId.toString()}/${userId.toString()}/user`;

      if (!isProjectAccountConnected) {
        // Project-level installation
        const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${MicrosoftTeamsAppClientId}&response_type=code&redirect_uri=${encodeURIComponent(project_install_redirect_uri)}&scope=${encodeURIComponent(scopes.join(" "))}&response_mode=query`;
        Navigation.navigate(URL.fromString(authUrl));
      } else {
        // User-level authentication only  
        const userAuthUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${MicrosoftTeamsAppClientId}&response_type=code&redirect_uri=${encodeURIComponent(user_signin_redirect_uri)}&scope=${encodeURIComponent(["https://graph.microsoft.com/User.Read"].join(" "))}&response_mode=query`;
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
    </Fragment>
  );
};

export default MicrosoftTeamsIntegration;
