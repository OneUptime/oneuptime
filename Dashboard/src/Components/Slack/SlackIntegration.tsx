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
import Link from "Common/UI/Components/Link/Link";
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
import ServiceProviderProjectAuthToken from "Common/Models/DatabaseModels/ServiceProviderProjectAuthToken";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ListResult from "Common/UI/Utils/BaseDatabase/ListResult";
import ServiceProviderUserAuthToken from "Common/Models/DatabaseModels/ServiceProviderUserAuthToken";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ServiceProviderType from "Common/Types/ServiceProvider/ServiceProviderType";


export interface ComponentProps {
  onConnected: VoidFunction;
  onDisconnected: VoidFunction;
}

const SlackIntegration: FunctionComponent<ComponentProps> = (props: ComponentProps): ReactElement => {
  const [error, setError] = React.useState<ReactElement | null>(null);

  const [isLoading, setIsLoading] = React.useState<boolean>(true);

  const [manifest, setManifest] = React.useState<JSONObject | null>(null);
  const [isUserAccountConnected, setIsUserAccountConnected] =
    React.useState<boolean>(false);
  const [userAuthTokenId, setServiceProviderUserAuthTokenId] =
    React.useState<ObjectID | null>(null);
  const [projectAuthTokenId, setServiceProviderProjectAuthTokenId] =
    React.useState<ObjectID | null>(null);
  const [
    isProjectAccountConnected,
    setIsProjectAccountConnected,
  ] = React.useState<boolean>(false);
  const [isButtonLoading, setIsButtonLoading] = React.useState<boolean>(false);
  


  useEffect(() => {
    if(isProjectAccountConnected){
      props.onConnected();
    }else{
      props.onDisconnected();
    }
  }, [isProjectAccountConnected]);


  const loadItems: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setError(null);
      setIsLoading(true);

      // check if the project is already connected with slack.
      const projectAuth: ListResult<ServiceProviderProjectAuthToken> =
        await ModelAPI.getList<ServiceProviderProjectAuthToken>({
          modelType: ServiceProviderProjectAuthToken,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
            serviceProviderType: ServiceProviderType.Slack,
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

      if (projectAuth.data.length > 0) {
        setIsProjectAccountConnected(true);
        setServiceProviderProjectAuthTokenId(projectAuth.data[0]!.id);
      }

      // fetch user auth token.

      const userAuth: ListResult<ServiceProviderUserAuthToken> =
        await ModelAPI.getList<ServiceProviderUserAuthToken>({
          modelType: ServiceProviderUserAuthToken,
          query: {
            userId: UserUtil.getUserId()!,
            serviceProviderType: ServiceProviderType.Slack,
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
        setServiceProviderUserAuthTokenId(userAuth.data[0]!.id);
      }

      if (!isUserAccountConnected || !isProjectAccountConnected) {
        // if any of this is not connected then fetch the app manifest, so we can connect with slack.

        // fetch app manifest.
        const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
          await API.get<JSONObject>(
            URL.fromString(`${HOME_URL.toString()}/api/slack/app-manifest`),
          );

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        setManifest(response.data);
      }
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

  let cardTitle: string = "";
  let cardDescription: string = "";
  let cardButtons: Array<CardButtonSchema> = [];

  // if user and project both connected with slack, then.
  if (isUserAccountConnected && isProjectAccountConnected) {
    cardTitle = `You are connected with Slack`;
    cardDescription = `Your account is already connected with Slack.`;
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
                modelType: ServiceProviderUserAuthToken,
                id: userAuthTokenId!,
              });

              setIsUserAccountConnected(false);
              setServiceProviderUserAuthTokenId(null);
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

  const connectWithSlack: VoidFunction = (): void => {
    if (SlackAppClientId) {
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

      // if any of the user or bot scopes length = = then error.
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

      const redirect_uri: string = `${APP_API_URL}/slack/auth/${projectId.toString()}/${userId.toString()}`;

      Navigation.navigate(
        URL.fromString(
          `https://slack.com/oauth/v2/authorize?scope=${botScopes.join(
            ",",
          )}&user_scope=${userScopes.join(
            ",",
          )}&client_id=${SlackAppClientId}&redirect_uri=${redirect_uri}`,
        ),
      );
    } else {
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
    }
  };

  type GetConnectWithSlackButtonFunction = (title: string) => CardButtonSchema;

  const getConnectWithSlackButton: GetConnectWithSlackButtonFunction = (
    title: string,
  ): CardButtonSchema => {
    return {
      title: title || `Connect with Slack`,
      buttonStyle: ButtonStyleType.PRIMARY,
      onClick: () => {
        return connectWithSlack();
      },

      icon: IconProp.Slack,
    };
  };

  // if user is not connected and the project is connected with slack.
  if (!isUserAccountConnected && isProjectAccountConnected) {
    cardTitle = `You are disconnected from Slack (but OneUptime is already installed in your team)`;
    cardDescription = `Connect your account with Slack to make the most out of OneUptime.`;
    cardButtons = [
      // connect with slack button.
      getConnectWithSlackButton(`Connect my account with Slack`),
      {
        title: `Uninstall OneUptime from Slack`,
        isLoading: isButtonLoading,
        buttonStyle: ButtonStyleType.DANGER,
        onClick: async () => {
          try {
            setIsButtonLoading(true);
            setError(null);
            if (projectAuthTokenId) {
              await ModelAPI.deleteItem({
                modelType: ServiceProviderProjectAuthToken,
                id: projectAuthTokenId!,
              });

              setIsProjectAccountConnected(false);
              setServiceProviderProjectAuthTokenId(null);
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
        icon: IconProp.Trash,
      },
    ];
  }

  if (!isUserAccountConnected && !isProjectAccountConnected) {
    cardTitle = `Connect with Slack`;
    cardDescription = `Connect your account with Slack to make the most out of OneUptime.`;
    cardButtons = [getConnectWithSlackButton(`Connect with Slack`)];
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

export default SlackIntegration;
