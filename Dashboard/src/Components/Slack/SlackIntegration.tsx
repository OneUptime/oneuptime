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
import { APP_API_URL, HOME_URL, SlackAppClientId } from "Common/UI/Config";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import Exception from "Common/Types/Exception/Exception";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import WorkspaceProjectAuthToken, {
  SlackMiscData,
} from "Common/Models/DatabaseModels/WorkspaceProjectAuthToken";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import WorkspaceUserAuthToken from "Common/Models/DatabaseModels/WorkspaceUserAuthToken";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SlackIntegrationDocumentation from "./SlackIntegrationDocumentation";
import Link from "Common/UI/Components/Link/Link";
import SlackChannelCacheModal from "./SlackChannelCacheModal";

export interface ComponentProps {
  onConnected: VoidFunction;
  onDisconnected: VoidFunction;
}

const SlackIntegration: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [error, setError] = React.useState<ReactElement | null>(null);

  const [isLoading, setIsLoading] = React.useState<boolean>(true);

  const [manifest, setManifest] = React.useState<JSONObject | null>(null);
  const [projectAuthTokens, setProjectAuthTokens] = React.useState<
    Array<WorkspaceProjectAuthToken>
  >([]);
  const [userAuthTokens, setUserAuthTokens] = React.useState<
    Array<WorkspaceUserAuthToken>
  >([]);
  const [isButtonLoading, setIsButtonLoading] = React.useState<boolean>(false);
  const [showChannelsModal, setShowChannelsModal] =
    React.useState<boolean>(false);
  const [selectedProjectAuthTokenId, setSelectedProjectAuthTokenId] =
    React.useState<ObjectID | null>(null);

  const isProjectAccountConnected: boolean = projectAuthTokens.length > 0;

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

      const projectAuth: ListResult<WorkspaceProjectAuthToken> =
        await ModelAPI.getList<WorkspaceProjectAuthToken>({
          modelType: WorkspaceProjectAuthToken,
          query: {
            projectId: projectId,
            workspaceType: WorkspaceType.Slack,
          },
          select: {
            _id: true,
            miscData: true,
            workspaceProjectId: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          sort: {
            createdAt: SortOrder.Ascending,
          },
        });

      setProjectAuthTokens(projectAuth.data);

      const userAuth: ListResult<WorkspaceUserAuthToken> =
        await ModelAPI.getList<WorkspaceUserAuthToken>({
          modelType: WorkspaceUserAuthToken,
          query: {
            userId: userId,
            projectId: projectId,
            workspaceType: WorkspaceType.Slack,
          },
          select: {
            _id: true,
            workspaceProjectId: true,
            miscData: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          sort: {
            createdAt: SortOrder.Descending,
          },
        });

      setUserAuthTokens(userAuth.data);

      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.get<JSONObject>({
          url: URL.fromString(`${HOME_URL.toString()}/api/slack/app-manifest`),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      setManifest(response.data);
    } catch (error) {
      setError(<div>{API.getFriendlyErrorMessage(error as Error)}</div>);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // if this page has aqueryn param with error, then there was the error in authentication.
    const error: string | null = Navigation.getQueryStringByName("error");

    if (error) {
      setError(
        <div>
          There was an error while connecting with Slack. Please try again.
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

  interface ConnectWithSlackData {
    mode: "workspace" | "user";
    expectedWorkspaceProjectId?: string;
  }

  type ConnectWithSlack = (data: ConnectWithSlackData) => void;

  const connectWithSlack: ConnectWithSlack = (
    data: ConnectWithSlackData,
  ): void => {
    if (!SlackAppClientId) {
      setError(
        <div>
          Looks like the Slack App Client ID is not set in the environment
          variables when you installed OneUptime. For more information, please
          check this guide to set up Slack App properly:{" "}
          <Link
            to={new Route("/docs/self-hosted/slack-integration")}
            openInNewTab={true}
          >
            Slack Integration
          </Link>
        </div>,
      );
      return;
    }

    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    const userId: ObjectID | null = UserUtil.getUserId();

    if (!projectId) {
      setError(
        <div>
          Looks like you have not selected any project. Please select a project
          to continue.
        </div>,
      );
      return;
    }

    if (!userId) {
      setError(
        <div>Looks like you are not logged in. Please login to continue.</div>,
      );
      return;
    }

    const projectInstallRedirectUri: string = `${APP_API_URL}/slack/auth/${projectId.toString()}/${userId.toString()}`;
    const userSigninRedirectUri: string = `${APP_API_URL}/slack/auth/${projectId.toString()}/${userId.toString()}/user`;

    if (data.mode === "workspace") {
      const userScopes: Array<string> = [];

      if (
        manifest &&
        manifest["oauth_config"] &&
        ((manifest["oauth_config"] as JSONObject)["scopes"] as JSONObject) &&
        ((manifest["oauth_config"] as JSONObject)["scopes"] as JSONObject)[
          "user"
        ] &&
        (
          ((manifest["oauth_config"] as JSONObject)["scopes"] as JSONObject)[
            "user"
          ] as Array<string>
        ).length > 0
      ) {
        userScopes.push(
          ...((
            (manifest["oauth_config"] as JSONObject)["scopes"] as JSONObject
          )["user"] as Array<string>),
        );
      }

      const botScopes: Array<string> = [];

      if (
        manifest &&
        manifest["oauth_config"] &&
        ((manifest["oauth_config"] as JSONObject)["scopes"] as JSONObject) &&
        ((manifest["oauth_config"] as JSONObject)["scopes"] as JSONObject)[
          "bot"
        ] &&
        (
          ((manifest["oauth_config"] as JSONObject)["scopes"] as JSONObject)[
            "bot"
          ] as Array<string>
        ).length > 0
      ) {
        botScopes.push(
          ...((
            (manifest["oauth_config"] as JSONObject)["scopes"] as JSONObject
          )["bot"] as Array<string>),
        );
      }

      if (userScopes.length === 0 || botScopes.length === 0) {
        setError(
          <div>
            Looks like the Slack App scopes are not set properly. For more
            information, please check this guide to set up Slack App properly:{" "}
            <Link
              to={new Route("/docs/self-hosted/slack-integration")}
              openInNewTab={true}
            >
              Slack Integration
            </Link>
          </div>,
        );
        return;
      }

      Navigation.navigate(
        URL.fromString(
          `https://slack.com/oauth/v2/authorize?scope=${botScopes.join(
            ",",
          )}&user_scope=${userScopes.join(
            ",",
          )}&client_id=${SlackAppClientId}&redirect_uri=${projectInstallRedirectUri}`,
        ),
      );
      return;
    }

    const stateParam: string | undefined = data.expectedWorkspaceProjectId;
    const stateQuery: string = stateParam
      ? `&state=${encodeURIComponent(stateParam)}`
      : "";

    Navigation.navigate(
      URL.fromString(
        `https://slack.com/openid/connect/authorize?response_type=code&scope=openid%20profile%20email&client_id=${SlackAppClientId}&redirect_uri=${userSigninRedirectUri}${stateQuery}`,
      ),
    );
  };

  type GetConnectWithSlackButtonFunction = (
    title: string,
    onClick: VoidFunction,
  ) => CardButtonSchema;

  const getConnectWithSlackButton: GetConnectWithSlackButtonFunction = (
    title: string,
    onClick: VoidFunction,
  ): CardButtonSchema => {
    return {
      title: title || `Connect with Slack`,
      buttonStyle: ButtonStyleType.PRIMARY,
      onClick: () => {
        return onClick();
      },

      icon: IconProp.Slack,
    };
  };

  const userAuthByWorkspaceProjectId: Map<string, WorkspaceUserAuthToken> =
    new Map();

  userAuthTokens.forEach((token: WorkspaceUserAuthToken) => {
    if (token.workspaceProjectId) {
      userAuthByWorkspaceProjectId.set(token.workspaceProjectId, token);
    }
  });

  const workspaceCards: Array<ReactElement> = projectAuthTokens.map(
    (workspace: WorkspaceProjectAuthToken) => {
      const teamName: string | undefined = (workspace.miscData as SlackMiscData)
        ?.teamName;

      const workspaceProjectId: string | undefined =
        workspace.workspaceProjectId;

      const userAuth: WorkspaceUserAuthToken | undefined = workspaceProjectId
        ? userAuthByWorkspaceProjectId.get(workspaceProjectId)
        : undefined;

      const buttons: Array<CardButtonSchema> = [];

      if (userAuth) {
        buttons.push({
          title: `Disconnect My Account`,
          isLoading: isButtonLoading,
          buttonStyle: ButtonStyleType.DANGER,
          onClick: async () => {
            try {
              setIsButtonLoading(true);
              setError(null);
              await ModelAPI.deleteItem({
                modelType: WorkspaceUserAuthToken,
                id: userAuth.id!,
              });
              await loadItems();
            } catch (error) {
              setError(
                <div>{API.getFriendlyErrorMessage(error as Exception)}</div>,
              );
            }
            setIsButtonLoading(false);
          },
          icon: IconProp.Close,
        });
      } else {
        buttons.push(
          getConnectWithSlackButton(`Connect My Account`, () => {
            const connectData: {
              mode: "user" | "workspace";
              expectedWorkspaceProjectId?: string;
            } = {
              mode: "user",
            };

            if (workspaceProjectId) {
              connectData.expectedWorkspaceProjectId = workspaceProjectId;
            }

            return connectWithSlack(connectData);
          }),
        );
      }

      buttons.push({
        title: `View Channels`,
        isLoading: isButtonLoading,
        buttonStyle: ButtonStyleType.NORMAL,
        onClick: async () => {
          try {
            setError(null);
            if (workspace.id) {
              setSelectedProjectAuthTokenId(workspace.id);
              setShowChannelsModal(true);
            }
          } catch (error) {
            setError(
              <div>{API.getFriendlyErrorMessage(error as Exception)}</div>,
            );
          }
        },
        icon: IconProp.Slack,
      });

      buttons.push({
        title: `Uninstall OneUptime from Slack`,
        isLoading: isButtonLoading,
        buttonStyle: ButtonStyleType.DANGER,
        onClick: async () => {
          try {
            setIsButtonLoading(true);
            setError(null);
            if (workspace.id) {
              await ModelAPI.deleteItem({
                modelType: WorkspaceProjectAuthToken,
                id: workspace.id,
              });
              await loadItems();
            }
          } catch (error) {
            setError(
              <div>{API.getFriendlyErrorMessage(error as Exception)}</div>,
            );
          }
          setIsButtonLoading(false);
        },
        icon: IconProp.Trash,
      });

      return (
        <Card
          key={workspace.id?.toString()}
          title={`Slack Workspace: ${teamName || workspaceProjectId || "Slack"}`}
          description={
            userAuth
              ? "Your account is connected to this Slack workspace."
              : "Connect your account to enable personalized Slack actions."
          }
          buttons={buttons}
        />
      );
    },
  );

  const connectWorkspaceCard: ReactElement = (
    <Card
      title={
        isProjectAccountConnected
          ? "Connect Another Slack Workspace"
          : "Connect with Slack"
      }
      description={
        isProjectAccountConnected
          ? "Install OneUptime in another Slack workspace."
          : "Install OneUptime in your Slack workspace."
      }
      buttons={[
        getConnectWithSlackButton(
          isProjectAccountConnected
            ? "Connect Another Workspace"
            : "Connect with Slack",
          () => {
            return connectWithSlack({ mode: "workspace" });
          },
        ),
      ]}
    />
  );

  if (!SlackAppClientId) {
    return <SlackIntegrationDocumentation manifest={manifest as JSONObject} />;
  }

  return (
    <Fragment>
      <div className="space-y-4">
        {connectWorkspaceCard}
        {workspaceCards}
      </div>
      {showChannelsModal && selectedProjectAuthTokenId ? (
        <SlackChannelCacheModal
          projectAuthTokenId={selectedProjectAuthTokenId}
          onClose={() => {
            setShowChannelsModal(false);
            setSelectedProjectAuthTokenId(null);
          }}
        />
      ) : null}
    </Fragment>
  );
};

export default SlackIntegration;
