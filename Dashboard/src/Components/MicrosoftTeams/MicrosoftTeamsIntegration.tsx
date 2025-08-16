import React, { FunctionComponent, ReactElement, useEffect } from "react";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ObjectID from "Common/Types/ObjectID";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import API from "Common/Utils/API";
import Exception from "Common/Types/Exception/Exception";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import WorkspaceProjectAuthToken from "Common/Models/DatabaseModels/WorkspaceProjectAuthToken";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import WorkspaceUserAuthToken from "Common/Models/DatabaseModels/WorkspaceUserAuthToken";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import URL from "Common/Types/API/URL";
import { APP_API_URL, MicrosoftTeamsAppClientId } from "Common/UI/Config";

export interface ComponentProps {
  onConnected: VoidFunction;
  onDisconnected: VoidFunction;
}

const MicrosoftTeamsIntegration: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [error, setError] = React.useState<string | null>(null);
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
        setWorkspaceProjectAuthTokenId(projectAuth.data[0]!.id);
      }

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

      setIsLoading(false);
    } catch (error) {
      setIsLoading(false);
  setError(API.getFriendlyErrorMessage(error as Exception));
    }
  };

  useEffect(() => {
    loadItems().catch(() => {
      // ignore
    });
  }, []);

  const connectWithTeams: VoidFunction = (): void => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    const userId: ObjectID | null = UserUtil.getUserId();

    if (!projectId || !userId) {
  setError("Please select a project and sign in.");
      return;
    }

    if (!MicrosoftTeamsAppClientId) {
      setError(
        "Microsoft Teams client id is not configured. Please set MICROSOFT_TEAMS_APP_CLIENT_ID.",
      );
      return;
    }

    const redirectUri: URL = URL.fromString(APP_API_URL.toString()).addRoute(
      `/microsoft-teams/auth/${projectId.toString()}/${userId.toString()}`,
    );

    const authorizeUrl: URL = URL.fromString(
      `https://login.microsoftonline.com/common/oauth2/v2.0/authorize`,
    )
  .addQueryParam("client_id", MicrosoftTeamsAppClientId)
      .addQueryParam("response_type", "code")
      .addQueryParam("response_mode", "query")
      .addQueryParam(
        "scope",
        [
          "openid",
          "profile",
          "User.Read",
          "Channel.ReadBasic.All",
          "ChannelMessage.Send",
          "Team.ReadBasic.All",
          "offline_access",
        ].join(" "),
      )
      .addQueryParam("redirect_uri", redirectUri.toString());

    window.location.href = authorizeUrl.toString();
  };

  const disconnect: VoidFunction = async (): Promise<void> => {
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

      if (projectAuthTokenId) {
        await ModelAPI.deleteItem({
          modelType: WorkspaceProjectAuthToken,
          id: projectAuthTokenId!,
        });
        setIsProjectAccountConnected(false);
        setWorkspaceProjectAuthTokenId(null);
      }
    } catch (error) {
      setError(API.getFriendlyErrorMessage(error as Exception));
    }
    setIsButtonLoading(false);
  };

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  const buttons: Array<CardButtonSchema> = [];

  if (!isProjectAccountConnected || !isUserAccountConnected) {
    buttons.push({
      title: `Connect Microsoft Teams`,
      buttonStyle: ButtonStyleType.NORMAL,
      onClick: connectWithTeams,
      icon: IconProp.MicrosoftTeams,
      isLoading: isButtonLoading,
    });
  } else {
    buttons.push({
      title: `Disconnect`,
      buttonStyle: ButtonStyleType.DANGER,
      onClick: disconnect,
      icon: IconProp.Close,
      isLoading: isButtonLoading,
    });
  }

  return (
    <Card
      title="Connect Microsoft Teams"
      description="Connect your project and user account to Microsoft Teams to receive notifications."
      buttons={buttons}
    >
  {error ? <ErrorMessage message={error} /> : undefined}
    </Card>
  );
};

export default MicrosoftTeamsIntegration;
