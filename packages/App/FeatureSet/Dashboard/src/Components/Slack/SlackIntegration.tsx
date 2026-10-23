import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
} from "react";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import CardMoreMenu from "Common/UI/Components/Card/CardMoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
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
import UninstallWorkspaceConfirm, {
  MANAGE_WORKSPACE_CONNECTION,
} from "../Workspace/UninstallWorkspaceConfirm";
import AskToConnectCard from "../Workspace/AskToConnectCard";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

/*
 * What each card of the Slack settings says. The project's card (Project
 * Settings only) and your own are apart: installing the app is the
 * project's, connecting your account is yours.
 */
export const CONNECT_WITH_SLACK_DESCRIPTION: string = translationKey(
  "Post incidents, alerts and scheduled maintenance to your Slack channels, give each incident a channel of its own, and let your team acknowledge, resolve and page from Slack.",
);

export const SLACK_INSTALLED_IN_WORKSPACE_TITLE: string = translationKey(
  "OneUptime is installed in the {{team}} Slack workspace",
);

export const SLACK_INSTALLED_TITLE: string = translationKey(
  "OneUptime is installed in Slack",
);

export const SLACK_INSTALLED_DESCRIPTION: string = translationKey(
  "It posts what your notification rules send, creates a channel for each incident and invites its people. Each member connects their own Slack account to act as themselves.",
);

export const YOUR_SLACK_ACCOUNT_CONNECTED_TITLE: string = translationKey(
  "Your Slack account is connected",
);

export const YOUR_SLACK_ACCOUNT_CONNECTED_DESCRIPTION: string = translationKey(
  "Buttons, commands and reactions in Slack act as you, with your permissions in this project, and the OneUptime app's Home in Slack shows your on-call shifts.",
);

export const SLACK_NOT_CONNECTED_TO_PROJECT_TITLE: string = translationKey(
  "Slack is not connected to this project yet",
);

export const SLACK_NOT_CONNECTED_TO_PROJECT_DESCRIPTION: string =
  translationKey(
    "A project admin connects it under Project Settings → Workspace → Slack. Then you can connect your own Slack account here.",
  );

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

  // Uninstalling, asked first (UninstallWorkspaceConfirm).
  const [isUninstallConfirmOpen, setIsUninstallConfirmOpen] =
    React.useState<boolean>(false);
  const [isUninstalling, setIsUninstalling] = React.useState<boolean>(false);
  const [uninstallError, setUninstallError] = React.useState<string>("");

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

  /*
   * Your own Slack account, connected: what that lets you do, and how to
   * undo it. The project's own connection - its channels, uninstalling the
   * app - is the card above this one, on Project Settings only.
   */
  if (isUserAccountConnected && isProjectAccountConnected) {
    cardTitle = YOUR_SLACK_ACCOUNT_CONNECTED_TITLE;
    cardDescription = YOUR_SLACK_ACCOUNT_CONNECTED_DESCRIPTION;
    cardButtons = [
      {
        title: `Disconnect`,
        isLoading: isButtonLoading,
        buttonStyle: ButtonStyleType.DANGER_OUTLINE,
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
    ];
  }

  /*
   * Uninstalls the app from the project's Slack workspace, once asked
   * (UninstallWorkspaceConfirm). A failure is said in the dialog, which
   * stays open to try again.
   */
  const uninstallFromSlack: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setIsUninstalling(true);
      setUninstallError("");

      if (!projectAuthTokenId) {
        setUninstallError(
          translator.translateText(
            "Looks like the project auth token id is not set properly. Please try again.",
          ) || "",
        );
        return;
      }

      await ModelAPI.deleteItem({
        modelType: WorkspaceProjectAuthToken,
        id: projectAuthTokenId,
      });

      setIsUninstallConfirmOpen(false);
      setIsProjectAccountConnected(false);
      setWorkspaceProjectAuthTokenId(null);
      /*
       * Uninstalling unlinks every member's Slack account too
       * (WorkspaceProjectAuthTokenService), yours included.
       */
      setIsUserAccountConnected(false);
      setWorkspaceUserAuthTokenId(null);

      /*
       * Every Workspace menu in the project lists only connected
       * workspaces: ask again, so they stop listing this one.
       */
      ConnectedWorkspaces.refresh().catch(() => {
        // A failed request leaves the menus as they were.
      });
    } catch (error) {
      setUninstallError(API.getFriendlyErrorMessage(error as Exception));
    } finally {
      setIsUninstalling(false);
    }
  };

  /*
   * The project's connection to Slack, on Project Settings: which
   * workspace, and - in its ⋯, whether or not your own account is
   * connected - the channel list and uninstalling the app. Neither is a
   * step anybody comes to the page for, so neither is a button: the card
   * asks nothing of you, and the Connect button under it stays the page's
   * one main action.
   */
  const projectCardActions: Array<ReactElement> = [
    <CardMoreMenu
      key="slack-project-actions"
      ariaLabel={translator.translateTemplate(MANAGE_WORKSPACE_CONNECTION, {
        workspace: "Slack",
      })}
      dataTestId="slack-project-actions"
    >
      {[
        <MoreMenuItem
          key="view-channels"
          text="View Channels"
          icon={IconProp.Slack}
          dataTestId="slack-view-channels"
          onClick={() => {
            setError(null);
            setShowChannelsModal(true);
          }}
        />,
        <MoreMenuItem
          key="uninstall"
          text="Uninstall OneUptime from Slack"
          icon={IconProp.Trash}
          isDestructive={true}
          dataTestId="slack-uninstall"
          onClick={() => {
            setUninstallError("");
            setIsUninstallConfirmOpen(true);
          }}
        />,
      ]}
    </CardMoreMenu>,
  ];

  if (!isProjectAccountConnected) {
    cardTitle = `Connect with Slack`;
    cardDescription = CONNECT_WITH_SLACK_DESCRIPTION;
    cardButtons = [getConnectWithSlackButton(`Connect with Slack`)];
  }

  /*
   * Your own settings, before anybody connected the project: installing the
   * app into a Slack workspace is for the project's settings, not for a
   * personal page.
   */
  if (!isProjectAccountConnected && props.hideProjectCards) {
    cardTitle = SLACK_NOT_CONNECTED_TO_PROJECT_TITLE;
    cardDescription = SLACK_NOT_CONNECTED_TO_PROJECT_DESCRIPTION;
    cardButtons = [];
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

      {isProjectAccountConnected && !props.hideProjectCards && (
        <div data-testid="slack-project-connection">
          <Card
            title={
              slackTeamName
                ? translator.translateTemplate(
                    SLACK_INSTALLED_IN_WORKSPACE_TITLE,
                    { team: slackTeamName },
                  )
                : SLACK_INSTALLED_TITLE
            }
            description={SLACK_INSTALLED_DESCRIPTION}
            buttons={projectCardActions}
          />
        </div>
      )}

      <div
        data-testid="slack-your-account"
        className={
          isProjectAccountConnected && !props.hideProjectCards ? "mt-6" : ""
        }
      >
        <Card
          title={cardTitle}
          description={cardDescription}
          buttons={cardButtons}
        />
      </div>

      {isProjectAccountConnected && !props.hideProjectCards && (
        <div className="mt-6">
          <AskToConnectCard workspaceType={WorkspaceType.Slack} />
        </div>
      )}

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

      {isUninstallConfirmOpen && isProjectAccountConnected ? (
        <UninstallWorkspaceConfirm
          workspaceName="Slack"
          isUninstalling={isUninstalling}
          error={uninstallError}
          onClose={() => {
            setIsUninstallConfirmOpen(false);
            setUninstallError("");
          }}
          onConfirm={() => {
            uninstallFromSlack().catch((error: Exception) => {
              setUninstallError(API.getFriendlyErrorMessage(error));
            });
          }}
        />
      ) : null}
    </Fragment>
  );
};

export default SlackIntegration;
