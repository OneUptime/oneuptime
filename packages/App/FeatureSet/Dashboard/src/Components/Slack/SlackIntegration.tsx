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
import API from "Common/UI/Utils/API/API";
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
import SlackIntegrationDocumentation from "./SlackIntegrationDocumentation";
import Link from "Common/UI/Components/Link/Link";
import SlackChannelCacheModal from "./SlackChannelCacheModal";
import SlackChannelsCard from "./SlackChannelsCard";
import ConnectedWorkspaces from "../../Utils/Workspace/ConnectedWorkspaces";
import ConnectCallbackNotice, {
  ConnectCallbackNoticeState,
  useConnectCallbackNotice,
} from "../Workspace/ConnectCallbackNotice";
import {
  CONNECT_REQUEST_QUERY_PARAM,
  CONNECT_START_PAGE_QUERY_PARAM,
  ConnectProvider,
  ConnectStartPage,
} from "Common/Types/Workspace/ConnectCallback";
import ConnectRequestNotice, {
  ConnectRequestConnecting,
  ConnectRequestState,
  useConnectRequest,
} from "../Workspace/ConnectRequestNotice";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

export interface ComponentProps {
  onConnected: VoidFunction;
  onDisconnected: VoidFunction;
  hideProjectCards?: boolean | undefined; // hide project-level cards (e.g. on User Settings)
  /*
   * The page this is on, which Slack sends the browser back to: the
   * project's settings unless said otherwise.
   */
  startPage?: ConnectStartPage | undefined;
}

const SlackIntegration: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [error, setError] = React.useState<ReactElement | null>(null);

  const translator: Translator = useTranslator();

  // What a connection that came back unmade says (?error=).
  const connectCallback: ConnectCallbackNoticeState = useConnectCallbackNotice({
    provider: ConnectProvider.Slack,
  });

  /*
   * A Connect button pressed in Slack (?connect=), and what became of the
   * press once the account was connected (?pressed=); or a note's Connect
   * Slack account link (?connectAccount=).
   */
  const connectRequest: ConnectRequestState = useConnectRequest({
    provider: ConnectProvider.Slack,
  });

  // On its way to Slack to sign in, for a Connect button pressed there.
  const [isConnectingFromSlack, setIsConnectingFromSlack] =
    React.useState<boolean>(false);

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
  const [slackTeamName, setSlackTeamName] = React.useState<string | null>(null);
  const [showChannelsModal, setShowChannelsModal] =
    React.useState<boolean>(false);

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

      // check if the project is already connected with slack.
      const projectAuth: ListResult<WorkspaceProjectAuthToken> =
        await ModelAPI.getList<WorkspaceProjectAuthToken>({
          modelType: WorkspaceProjectAuthToken,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
            workspaceType: WorkspaceType.Slack,
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
        const slackTeamName: string | undefined = (
          projectAuth.data[0]!.miscData! as SlackMiscData
        ).teamName;
        setWorkspaceProjectAuthTokenId(projectAuth.data[0]!.id);
        setSlackTeamName(slackTeamName);
      }

      // fetch user auth token.

      const userAuth: ListResult<WorkspaceUserAuthToken> =
        await ModelAPI.getList<WorkspaceUserAuthToken>({
          modelType: WorkspaceUserAuthToken,
          query: {
            userId: UserUtil.getUserId()!,
            workspaceType: WorkspaceType.Slack,
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

      if (!isUserAccountConnected || !isProjectAccountConnected) {
        // if any of this is not connected then fetch the app manifest, so we can connect with slack.

        // fetch app manifest.
        const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
          await API.get<JSONObject>({
            url: URL.fromString(
              `${HOME_URL.toString()}/api/slack/app-manifest`,
            ),
          });

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
    /*
     * A connection that came back unmade is said above the page
     * (connectCallback), which loads as usual, its Connect button right
     * there to try again.
     */
    loadItems().catch((error: Exception) => {
      setError(<div>{API.getFriendlyErrorMessage(error)}</div>);
    });
  }, []);

  /*
   * Starts "sign in with Slack" for the press a Connect button in Slack
   * stands for (`connect`), and takes the browser there. A press that can no
   * longer be used - spent, or expired - is answered by the server with a
   * 400: the page says so, its own Connect button right below. Without a
   * token (a note's Connect Slack account link) it is the sign-in the
   * page's own Connect button starts.
   */
  type StartSignInFromSlackFunction = (token: string | null) => Promise<void>;

  const startSignInFromSlack: StartSignInFromSlackFunction = async (
    token: string | null,
  ): Promise<void> => {
    const signInUrl: URL = URL.fromURL(APP_API_URL)
      .addRoute("/slack/sign-in-url")
      .addQueryParam(
        CONNECT_START_PAGE_QUERY_PARAM,
        props.startPage || ConnectStartPage.ProjectSettings,
      );

    if (token) {
      signInUrl.addQueryParam(CONNECT_REQUEST_QUERY_PARAM, token);
    }

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.get<JSONObject>({
        url: signInUrl,
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse) {
      if (token && response.statusCode === 400) {
        setIsConnectingFromSlack(false);
        connectRequest.markLinkGone(isUserAccountConnected);
        return;
      }

      throw response;
    }

    const authorizationUrl: string | undefined = (response.data as JSONObject)[
      "authorizationUrl"
    ] as string | undefined;

    if (!authorizationUrl) {
      throw new Error(
        "OneUptime could not start the Slack connection. Please try again.",
      );
    }

    Navigation.navigate(URL.fromString(authorizationUrl));
  };

  /*
   * Opened from a Connect button in Slack: the account is connected straight
   * away - the sign-in starts on its own, carrying the press, so the person
   * presses nothing more here. Only once the page knows the project is
   * connected to Slack; otherwise the page shows itself as usual.
   */
  useEffect(() => {
    if (isLoading || !connectRequest.connectToken) {
      return;
    }

    const token: string = connectRequest.connectToken;
    connectRequest.takeToken();

    if (!isProjectAccountConnected || !SlackAppClientId) {
      return;
    }

    setIsConnectingFromSlack(true);

    /*
     * A start that fails is said above the page, which shows as usual: its
     * own Connect button is right there to try again.
     */
    startSignInFromSlack(token).catch((error: Exception) => {
      setIsConnectingFromSlack(false);
      connectRequest.markStartFailed(API.getFriendlyErrorMessage(error));
    });
  }, [isLoading, isProjectAccountConnected]);

  /*
   * Opened from the Connect Slack account link in a Slack channel's note
   * (the people OneUptime could not add to it): somebody whose account is
   * not connected yet is taken to Slack to connect it straight away.
   * Somebody connected already sees the page as usual - it says so - and
   * so does everybody while the project itself is not connected to Slack.
   */
  useEffect(() => {
    if (isLoading || !connectRequest.connectAccount) {
      return;
    }

    connectRequest.takeConnectAccount();

    if (
      // A Connect button's press, opened with it, signs in for that press.
      connectRequest.connectToken ||
      isUserAccountConnected ||
      !isProjectAccountConnected ||
      !SlackAppClientId
    ) {
      return;
    }

    setIsConnectingFromSlack(true);

    startSignInFromSlack(null).catch((error: Exception) => {
      setIsConnectingFromSlack(false);
      connectRequest.markStartFailed(API.getFriendlyErrorMessage(error));
    });
  }, [isLoading, isProjectAccountConnected, isUserAccountConnected]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (isConnectingFromSlack) {
    return <ConnectRequestConnecting provider={ConnectProvider.Slack} />;
  }

  if (error) {
    return (
      <Fragment>
        <ConnectCallbackNotice state={connectCallback} />
        <ConnectRequestNotice state={connectRequest} />
        <ErrorMessage message={error} />
      </Fragment>
    );
  }

  let cardTitle: string = "";
  let cardDescription: string = "";
  let cardButtons: Array<CardButtonSchema> = [];

  // if user and project both connected with slack, then.
  if (isUserAccountConnected && isProjectAccountConnected) {
    cardTitle = `You are connected with ${slackTeamName} team on Slack`;
    cardDescription = `Your account is already connected with Slack.`;
    cardButtons = [
      {
        title: `View Channels`,
        isLoading: isButtonLoading,
        buttonStyle: ButtonStyleType.NORMAL,
        onClick: async () => {
          try {
            setError(null);
            setShowChannelsModal(true);
          } catch (error) {
            setError(
              <div>{API.getFriendlyErrorMessage(error as Exception)}</div>,
            );
          }
        },
        icon: IconProp.Slack,
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

  /*
   * The server builds the Slack URL and records a single-use `state` for this
   * user and project; the callback trusts only that record. The browser never
   * chooses the project or user a connection is written to.
   */
  type NavigateToAuthorizationUrlFunction = (route: string) => Promise<void>;

  const navigateToAuthorizationUrl: NavigateToAuthorizationUrlFunction = async (
    route: string,
  ): Promise<void> => {
    try {
      setError(null);

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get<JSONObject>({
          // Slack sends the browser back to this page.
          url: URL.fromURL(APP_API_URL)
            .addRoute(route)
            .addQueryParam(
              CONNECT_START_PAGE_QUERY_PARAM,
              props.startPage || ConnectStartPage.ProjectSettings,
            ),
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      const authorizationUrl: string | undefined = (
        response.data as JSONObject
      )["authorizationUrl"] as string | undefined;

      if (!authorizationUrl) {
        throw new Error(
          "OneUptime could not start the Slack connection. Please try again.",
        );
      }

      Navigation.navigate(URL.fromString(authorizationUrl));
    } catch (error) {
      setError(<div>{API.getFriendlyErrorMessage(error as Exception)}</div>);
    }
  };

  const connectWithSlack: VoidFunction = (): void => {
    if (SlackAppClientId) {
      if (!ProjectUtil.getCurrentProjectId()) {
        setError(
          <div>
            Looks like you have not selected any project. Please select a
            project to continue.
          </div>,
        );
        return;
      }

      if (!UserUtil.getUserId()) {
        setError(
          <div>
            Looks like you are not logged in. Please login to continue.
          </div>,
        );
        return;
      }

      /*
       * Not connected yet: install the app into a workspace. Already
       * connected: only sign the user in with Slack.
       */
      navigateToAuthorizationUrl(
        isProjectAccountConnected ? "/slack/sign-in-url" : "/slack/install-url",
      ).catch((error: Exception) => {
        setError(<div>{API.getFriendlyErrorMessage(error)}</div>);
      });
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

  /*
   * The project is connected to Slack, the person is not: what to do, as
   * the Setup Checklist says it, and the workspace to sign in to. A Connect
   * button that expired, or a sign-in that could not start, points here.
   */
  if (!isUserAccountConnected && isProjectAccountConnected) {
    cardTitle = "Connect your Slack account";
    cardDescription = slackTeamName
      ? translator.translateTemplate(
          "OneUptime is installed in the {{team}} Slack workspace. Connect your account there to acknowledge incidents and get messages as yourself, in Slack.",
          { team: slackTeamName },
        )
      : "Acknowledge incidents and get messages from OneUptime as yourself, in Slack.";
    cardButtons = [
      // connect with slack button.
      getConnectWithSlackButton(`Connect my account with Slack`),
      {
        title: `View Channels`,
        isLoading: isButtonLoading,
        buttonStyle: ButtonStyleType.NORMAL,
        onClick: async () => {
          try {
            setError(null);
            setShowChannelsModal(true);
          } catch (error) {
            setError(
              <div>{API.getFriendlyErrorMessage(error as Exception)}</div>,
            );
          }
        },
        icon: IconProp.Slack,
      },
      {
        title: `Uninstall OneUptime from Slack`,
        isLoading: isButtonLoading,
        /*
         * Red, but outlined: "Connect my account with Slack" beside it is the
         * card's one primary button, and a filled red one would compete with
         * it for a step almost nobody on this card has come to take.
         */
        buttonStyle: ButtonStyleType.DANGER_OUTLINE,
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

              /*
               * Every Workspace menu in the project lists only connected
               * workspaces: ask again, so they stop listing this one.
               */
              ConnectedWorkspaces.refresh().catch(() => {
                // A failed request leaves the menus as they were.
              });
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

  if (!isProjectAccountConnected) {
    cardTitle = `Connect with Slack`;
    cardDescription = `Connect your account with Slack to make the most out of OneUptime.`;
    cardButtons = [getConnectWithSlackButton(`Connect with Slack`)];
  }

  if (!SlackAppClientId) {
    return (
      <Fragment>
        <ConnectCallbackNotice state={connectCallback} />
        <SlackIntegrationDocumentation manifest={manifest as JSONObject} />
      </Fragment>
    );
  }

  return (
    <Fragment>
      <ConnectCallbackNotice state={connectCallback} />
      <ConnectRequestNotice state={connectRequest} />

      <div>
        <Card
          title={cardTitle}
          description={cardDescription}
          buttons={cardButtons}
        />
      </div>

      {isProjectAccountConnected && !props.hideProjectCards && (
        <div className="mt-6">
          <SlackChannelsCard />
        </div>
      )}

      {showChannelsModal && isProjectAccountConnected ? (
        <SlackChannelCacheModal
          onClose={() => {
            return setShowChannelsModal(false);
          }}
        />
      ) : null}
    </Fragment>
  );
};

export default SlackIntegration;
