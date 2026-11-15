import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import CardMoreMenu from "Common/UI/Components/Card/CardMoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import URL from "Common/Types/API/URL";
import Route from "Common/Types/API/Route";
import { APP_API_URL } from "Common/UI/Config";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ObjectID from "Common/Types/ObjectID";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import API from "Common/UI/Utils/API/API";
import Exception from "Common/Types/Exception/Exception";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import WorkspaceProjectAuthToken, {
  MattermostMiscData,
} from "Common/Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "Common/Models/DatabaseModels/WorkspaceUserAuthToken";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Navigation from "Common/UI/Utils/Navigation";
import ConnectedWorkspaces from "../../Utils/Workspace/ConnectedWorkspaces";
import ConnectCallbackNotice, {
  ConnectCallbackNoticeState,
  useConnectCallbackNotice,
} from "../Workspace/ConnectCallbackNotice";
import {
  CONNECT_ACCOUNT_QUERY_PARAM,
  CONNECT_ACCOUNT_QUERY_VALUE,
  CONNECT_START_PAGE_QUERY_PARAM,
  ConnectProvider,
  ConnectStartPage,
} from "Common/Types/Workspace/ConnectCallback";
import UninstallWorkspaceConfirm, {
  MANAGE_WORKSPACE_CONNECTION,
} from "../Workspace/UninstallWorkspaceConfirm";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import MattermostTeamsCard, {
  MattermostTeamOfProject,
  MattermostTeamsDescription,
} from "./MattermostTeamsCard";

/*
 * What each card of the Mattermost settings says. The project's card
 * (Project Settings only) and your own are apart: connecting the bot is the
 * project's, connecting your account is yours.
 */
export const CONNECT_WITH_MATTERMOST_TITLE: string = translationKey(
  "Connect with Mattermost",
);

export const CONNECT_WITH_MATTERMOST_DESCRIPTION: string = translationKey(
  "Post incidents, alerts and scheduled maintenance to your Mattermost channels, give each incident a channel of its own, and let your team acknowledge and resolve from Mattermost.",
);

export const MATTERMOST_CONNECTED_TITLE: string = translationKey(
  "OneUptime is connected to the {{team}} team in Mattermost",
);

// Its bot in two or more teams: the teams card under it names them (MattermostTeamsCard).
export const MATTERMOST_CONNECTED_TO_TEAMS_TITLE: string = translationKey(
  "OneUptime is connected to Mattermost",
);

export const MATTERMOST_CONNECTED_DESCRIPTION: string = translationKey(
  "It posts as @{{bot}} on {{server}}: what your notification rules send, a channel for each incident with its people added. Each member connects their own Mattermost account to act as themselves.",
);

export const MATTERMOST_SETUP_GUIDE: string = translationKey("Set-up guide");

export const CONNECT_FORM_DESCRIPTION: string = translationKey(
  "Create a bot account for OneUptime in Mattermost, add it to your team, and paste its access token here.",
);

export const CHOOSE_TEAM_TITLE: string = translationKey("Choose a team");

/*
 * A bot in several teams: OneUptime works in each of them, and the one
 * chosen is the default - where a notification rule that names no team
 * posts. Another can be made the default later (MattermostTeamsCard).
 */
export const CHOOSE_TEAM_DESCRIPTION: string = translationKey(
  "The bot account is in several teams, and OneUptime works in each. Choose the default team, where a rule that names no team creates its channels.",
);

export const DEFAULT_TEAM_TITLE: string = translationKey("Default team");

export const YOUR_MATTERMOST_ACCOUNT_CONNECTED_TITLE: string = translationKey(
  "Your Mattermost account is connected",
);

export const YOUR_MATTERMOST_ACCOUNT_CONNECTED_DESCRIPTION: string =
  translationKey(
    "Buttons on OneUptime's messages in Mattermost act as you, with your permissions in this project.",
  );

export const CONNECT_YOUR_MATTERMOST_ACCOUNT_TITLE: string = translationKey(
  "Connect your Mattermost account",
);

export const CONNECT_YOUR_MATTERMOST_ACCOUNT_DESCRIPTION: string =
  translationKey(
    "OneUptime sends your Mattermost account a direct message with a link. Open it in this browser to finish connecting.",
  );

export const MATTERMOST_LINK_SENT_DESCRIPTION: string = translationKey(
  "OneUptime sent a link to @{{username}} in Mattermost. Open it in this browser to finish connecting. It works once, for 15 minutes.",
);

export const SEND_LINK_TO_USERNAME: string = translationKey(
  "Send link to @{{username}}",
);

export const SEND_LINK_TITLE: string = translationKey(
  "Send a link to your Mattermost account",
);

export const MATTERMOST_NOT_CONNECTED_TO_PROJECT_TITLE: string = translationKey(
  "Mattermost is not connected to this project yet",
);

export const MATTERMOST_NOT_CONNECTED_TO_PROJECT_DESCRIPTION: string =
  translationKey(
    "A project admin connects it under Project Settings → Workspace → Mattermost. Then you can connect your own Mattermost account here.",
  );

// Where the guide to making the bot account is.
export const MATTERMOST_DOCS_ROUTE: Route = new Route(
  "/docs/workspace-connections/mattermost",
);

export interface ComponentProps {
  onConnected: VoidFunction;
  onDisconnected: VoidFunction;
  // Hide the project's cards (User Settings).
  hideProjectCards?: boolean | undefined;
  // The page this is on, which the account link's callback sends the browser back to.
  startPage?: ConnectStartPage | undefined;
}

// A team the bot account is in, as the server lists it.
interface MattermostTeamOption {
  id: string;
  name: string;
  displayName: string;
}

// What the connect form was filled in with, kept while a team is chosen.
interface MattermostConnectValues {
  serverUrl: string;
  accessToken: string;
}

const MattermostIntegration: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  // What a link that came back unused says (?error=).
  const connectCallback: ConnectCallbackNoticeState = useConnectCallbackNotice({
    provider: ConnectProvider.Mattermost,
  });

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const [projectAuthTokenId, setProjectAuthTokenId] = useState<ObjectID | null>(
    null,
  );
  const [miscData, setMiscData] = useState<MattermostMiscData | null>(null);
  // The teams the project's bot works in, as the teams card last read them.
  const [connectedTeams, setConnectedTeams] =
    useState<MattermostTeamsDescription | null>(null);
  const [userAuthTokenId, setUserAuthTokenId] = useState<ObjectID | null>(null);

  // Connecting the project: the form, then - for a bot in several teams - the team.
  const [isConnectFormOpen, setIsConnectFormOpen] = useState<boolean>(false);
  const [connectValues, setConnectValues] =
    useState<MattermostConnectValues | null>(null);
  const [teams, setTeams] = useState<Array<MattermostTeamOption>>([]);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [connectError, setConnectError] = useState<string>("");

  // Connecting your account: the account a link goes to, and the one it went to.
  const [suggestedUsername, setSuggestedUsername] = useState<string | null>(
    null,
  );
  const [sentToUsername, setSentToUsername] = useState<string | null>(null);
  const [isUsernameFormOpen, setIsUsernameFormOpen] = useState<boolean>(false);
  const [isSendingLink, setIsSendingLink] = useState<boolean>(false);
  const [sendLinkError, setSendLinkError] = useState<string>("");
  const [isDisconnectingAccount, setIsDisconnectingAccount] =
    useState<boolean>(false);

  // Disconnecting the project, asked first (UninstallWorkspaceConfirm).
  const [isUninstallConfirmOpen, setIsUninstallConfirmOpen] =
    useState<boolean>(false);
  const [isUninstalling, setIsUninstalling] = useState<boolean>(false);
  const [uninstallError, setUninstallError] = useState<string>("");

  const isProjectConnected: boolean = Boolean(projectAuthTokenId);
  const isUserConnected: boolean = Boolean(userAuthTokenId);

  useEffect(() => {
    if (isProjectConnected) {
      props.onConnected();
    } else {
      props.onDisconnected();
    }
  }, [isProjectConnected]);

  const loadItems: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setError("");
      setIsLoading(true);

      const projectAuth: ListResult<WorkspaceProjectAuthToken> =
        await ModelAPI.getList<WorkspaceProjectAuthToken>({
          modelType: WorkspaceProjectAuthToken,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
            workspaceType: WorkspaceType.Mattermost,
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

      const connection: WorkspaceProjectAuthToken | undefined =
        projectAuth.data[0];

      setProjectAuthTokenId(connection?.id || null);
      setMiscData(
        (connection?.miscData as MattermostMiscData | undefined) || null,
      );

      const userAuth: ListResult<WorkspaceUserAuthToken> =
        await ModelAPI.getList<WorkspaceUserAuthToken>({
          modelType: WorkspaceUserAuthToken,
          query: {
            userId: UserUtil.getUserId()!,
            workspaceType: WorkspaceType.Mattermost,
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

      const userConnection: WorkspaceUserAuthToken | undefined =
        userAuth.data[0];

      setUserAuthTokenId(userConnection?.id || null);

      // Whom a link would go to: the account with your email address, when the server shows it.
      if (connection && !userConnection) {
        setSuggestedUsername(await getSuggestedUsername());
      }
    } catch (err) {
      setError(API.getFriendlyErrorMessage(err as Exception));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadItems().catch((err: Exception) => {
      setError(API.getFriendlyErrorMessage(err));
    });
  }, []);

  /*
   * Opened from the Connect Mattermost account link in a channel's note
   * (the people OneUptime could not add to it): somebody not connected yet
   * is asked straight away whom to send the link to.
   */
  useEffect(() => {
    if (isLoading || !isProjectConnected || isUserConnected) {
      return;
    }

    if (
      Navigation.getQueryStringByName(CONNECT_ACCOUNT_QUERY_PARAM) ===
      CONNECT_ACCOUNT_QUERY_VALUE
    ) {
      setIsUsernameFormOpen(true);
    }
  }, [isLoading, isProjectConnected, isUserConnected]);

  const getSuggestedUsername: () => Promise<string | null> = async (): Promise<
    string | null
  > => {
    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get<JSONObject>({
          url: URL.fromURL(APP_API_URL).addRoute(
            "/mattermost/account-suggestion",
          ),
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        return null;
      }

      const username: unknown = (response.data as JSONObject)["username"];

      return typeof username === "string" && username ? username : null;
    } catch {
      // Nothing to offer: the person types their username instead.
      return null;
    }
  };

  type PostFunction = (
    route: string,
    data: JSONObject,
    query?: Record<string, string> | undefined,
  ) => Promise<JSONObject>;

  const post: PostFunction = async (
    route: string,
    data: JSONObject,
    query?: Record<string, string> | undefined,
  ): Promise<JSONObject> => {
    const url: URL = URL.fromURL(APP_API_URL).addRoute(route);

    for (const [name, value] of Object.entries(query || {})) {
      url.addQueryParam(name, value);
    }

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: url,
        data: data,
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    return response.data as JSONObject;
  };

  type ConnectFunction = (data: {
    values: MattermostConnectValues;
    teamId?: string | undefined;
  }) => Promise<void>;

  const connect: ConnectFunction = async (data: {
    values: MattermostConnectValues;
    teamId?: string | undefined;
  }): Promise<void> => {
    await post("/mattermost/connect", {
      serverUrl: data.values.serverUrl,
      accessToken: data.values.accessToken,
      ...(data.teamId ? { teamId: data.teamId } : {}),
    });

    setIsConnectFormOpen(false);
    setConnectValues(null);
    setTeams([]);

    /*
     * Every Workspace menu in the project lists only connected workspaces:
     * ask again, so they list this one.
     */
    ConnectedWorkspaces.refresh().catch(() => {
      // A failed request leaves the menus as they were.
    });

    await loadItems();
  };

  /*
   * The connect form, sent: the bot's teams are asked for first. A bot in
   * one team is connected to it at once; one in several asks which.
   */
  type SubmitConnectFormFunction = (values: JSONObject) => Promise<void>;

  const submitConnectForm: SubmitConnectFormFunction = async (
    values: JSONObject,
  ): Promise<void> => {
    const typed: MattermostConnectValues = {
      serverUrl: String(values["serverUrl"] || "").trim(),
      accessToken: String(values["accessToken"] || "").trim(),
    };

    try {
      setIsConnecting(true);
      setConnectError("");

      const answer: JSONObject = await post("/mattermost/teams", {
        serverUrl: typed.serverUrl,
        accessToken: typed.accessToken,
      });

      const listed: Array<MattermostTeamOption> = (
        (answer["teams"] as JSONArray | undefined) || []
      ).map((team: JSONObject): MattermostTeamOption => {
        return {
          id: String(team["id"] || ""),
          name: String(team["name"] || ""),
          displayName: String(team["displayName"] || team["name"] || ""),
        };
      });

      if (listed.length > 1) {
        setConnectValues(typed);
        setTeams(listed);
        setIsConnectFormOpen(false);
        return;
      }

      // One team, or none: the server connects it, or says what to do.
      await connect({ values: typed });
    } catch (err) {
      setConnectError(API.getFriendlyErrorMessage(err as Exception));
    } finally {
      setIsConnecting(false);
    }
  };

  type SubmitTeamFunction = (values: JSONObject) => Promise<void>;

  const submitTeam: SubmitTeamFunction = async (
    values: JSONObject,
  ): Promise<void> => {
    if (!connectValues) {
      return;
    }

    try {
      setIsConnecting(true);
      setConnectError("");

      await connect({
        values: connectValues,
        teamId: String(values["teamId"] || ""),
      });
    } catch (err) {
      setConnectError(API.getFriendlyErrorMessage(err as Exception));
    } finally {
      setIsConnecting(false);
    }
  };

  /*
   * Sends your Mattermost account the one-use link that connects it: to the
   * account of the username typed, or else the one with your email
   * address. The link is bound to this browser on the server
   * (WorkspaceOAuthState), so it is opened here.
   */
  type SendLinkFunction = (username: string | null) => Promise<void>;

  const sendLink: SendLinkFunction = async (
    username: string | null,
  ): Promise<void> => {
    try {
      setIsSendingLink(true);
      setSendLinkError("");

      // The callback sends the browser back to this page.
      const answer: JSONObject = await post(
        "/mattermost/sign-in-link",
        username ? { username: username } : {},
        {
          [CONNECT_START_PAGE_QUERY_PARAM]:
            props.startPage || ConnectStartPage.ProjectSettings,
        },
      );

      setSentToUsername(String(answer["username"] || username || ""));
      setIsUsernameFormOpen(false);
    } catch (err) {
      setSendLinkError(API.getFriendlyErrorMessage(err as Exception));
    } finally {
      setIsSendingLink(false);
    }
  };

  const disconnectAccount: PromiseVoidFunction = async (): Promise<void> => {
    if (!userAuthTokenId) {
      return;
    }

    try {
      setIsDisconnectingAccount(true);
      setError("");

      await ModelAPI.deleteItem({
        modelType: WorkspaceUserAuthToken,
        id: userAuthTokenId,
      });

      setUserAuthTokenId(null);
      setSentToUsername(null);
      setSuggestedUsername(await getSuggestedUsername());
    } catch (err) {
      setError(API.getFriendlyErrorMessage(err as Exception));
    } finally {
      setIsDisconnectingAccount(false);
    }
  };

  /*
   * Disconnects the project from Mattermost, once asked. Every member's
   * Mattermost account is disconnected with it
   * (WorkspaceProjectAuthTokenService).
   */
  const uninstall: PromiseVoidFunction = async (): Promise<void> => {
    if (!projectAuthTokenId) {
      return;
    }

    try {
      setIsUninstalling(true);
      setUninstallError("");

      await ModelAPI.deleteItem({
        modelType: WorkspaceProjectAuthToken,
        id: projectAuthTokenId,
      });

      setIsUninstallConfirmOpen(false);
      setProjectAuthTokenId(null);
      setMiscData(null);
      setConnectedTeams(null);
      setUserAuthTokenId(null);
      setSentToUsername(null);

      ConnectedWorkspaces.refresh().catch(() => {
        // A failed request leaves the menus as they were.
      });
    } catch (err) {
      setUninstallError(API.getFriendlyErrorMessage(err as Exception));
    } finally {
      setIsUninstalling(false);
    }
  };

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return (
      <Fragment>
        <ConnectCallbackNotice state={connectCallback} />
        <ErrorMessage message={error} />
      </Fragment>
    );
  }

  const setupGuideButton: CardButtonSchema = {
    title: MATTERMOST_SETUP_GUIDE,
    buttonStyle: ButtonStyleType.NORMAL,
    icon: IconProp.Book,
    onClick: () => {
      Navigation.navigate(MATTERMOST_DOCS_ROUTE, { openInNewTab: true });
    },
  };

  /*
   * The project's card names the team OneUptime works in - while there is
   * one. A bot in several teams works in each of them, and the teams card
   * names them, the default first.
   */
  const defaultTeam: MattermostTeamOfProject | undefined =
    connectedTeams?.teams.find((team: MattermostTeamOfProject): boolean => {
      return team.isDefault;
    });

  const projectCardTitle: string =
    (connectedTeams?.teams.length || 0) > 1
      ? MATTERMOST_CONNECTED_TO_TEAMS_TITLE
      : translator.translateTemplate(MATTERMOST_CONNECTED_TITLE, {
          team:
            defaultTeam?.displayName ||
            miscData?.teamDisplayName ||
            miscData?.teamName ||
            "",
        });

  let accountTitle: string;
  let accountDescription: string;
  let accountButtons: Array<CardButtonSchema> = [];

  if (!isProjectConnected && props.hideProjectCards) {
    accountTitle = MATTERMOST_NOT_CONNECTED_TO_PROJECT_TITLE;
    accountDescription = MATTERMOST_NOT_CONNECTED_TO_PROJECT_DESCRIPTION;
  } else if (!isProjectConnected) {
    accountTitle = CONNECT_WITH_MATTERMOST_TITLE;
    accountDescription = CONNECT_WITH_MATTERMOST_DESCRIPTION;
    accountButtons = [
      {
        title: CONNECT_WITH_MATTERMOST_TITLE,
        buttonStyle: ButtonStyleType.PRIMARY,
        icon: IconProp.Mattermost,
        onClick: () => {
          setConnectError("");
          setIsConnectFormOpen(true);
        },
      },
      setupGuideButton,
    ];
  } else if (isUserConnected) {
    accountTitle = YOUR_MATTERMOST_ACCOUNT_CONNECTED_TITLE;
    accountDescription = YOUR_MATTERMOST_ACCOUNT_CONNECTED_DESCRIPTION;
    accountButtons = [
      {
        title: "Disconnect",
        buttonStyle: ButtonStyleType.DANGER_OUTLINE,
        icon: IconProp.Close,
        isLoading: isDisconnectingAccount,
        onClick: () => {
          disconnectAccount().catch((err: Exception) => {
            setError(API.getFriendlyErrorMessage(err));
          });
        },
      },
    ];
  } else {
    accountTitle = CONNECT_YOUR_MATTERMOST_ACCOUNT_TITLE;
    accountDescription = sentToUsername
      ? translator.translateTemplate(MATTERMOST_LINK_SENT_DESCRIPTION, {
          username: sentToUsername,
        })
      : CONNECT_YOUR_MATTERMOST_ACCOUNT_DESCRIPTION;

    const linkTarget: string | null = sentToUsername || suggestedUsername;

    accountButtons = linkTarget
      ? [
          {
            title: translator.translateTemplate(SEND_LINK_TO_USERNAME, {
              username: linkTarget,
            }),
            buttonStyle: sentToUsername
              ? ButtonStyleType.NORMAL
              : ButtonStyleType.PRIMARY,
            icon: IconProp.Mattermost,
            isLoading: isSendingLink && !isUsernameFormOpen,
            onClick: () => {
              sendLink(linkTarget).catch((err: Exception) => {
                setSendLinkError(API.getFriendlyErrorMessage(err));
              });
            },
          },
          {
            title: "Use a different account",
            buttonStyle: ButtonStyleType.NORMAL,
            icon: IconProp.Edit,
            onClick: () => {
              setSendLinkError("");
              setIsUsernameFormOpen(true);
            },
          },
        ]
      : [
          {
            title: "Send me a link",
            buttonStyle: ButtonStyleType.PRIMARY,
            icon: IconProp.Mattermost,
            onClick: () => {
              setSendLinkError("");
              setIsUsernameFormOpen(true);
            },
          },
        ];
  }

  return (
    <Fragment>
      <ConnectCallbackNotice state={connectCallback} />

      {isProjectConnected && !props.hideProjectCards && (
        <div data-testid="mattermost-project-connection">
          <Card
            title={projectCardTitle}
            description={translator.translateTemplate(
              MATTERMOST_CONNECTED_DESCRIPTION,
              {
                bot: miscData?.botUsername || "",
                server: miscData?.serverUrl || "",
              },
            )}
            buttons={[
              <CardMoreMenu
                key="mattermost-project-actions"
                ariaLabel={translator.translateTemplate(
                  MANAGE_WORKSPACE_CONNECTION,
                  { workspace: "Mattermost" },
                )}
                isAriaLabelTranslated={true}
                dataTestId="mattermost-project-actions"
              >
                {[
                  <MoreMenuItem
                    key="setup-guide"
                    text={MATTERMOST_SETUP_GUIDE}
                    icon={IconProp.Book}
                    onClick={() => {
                      Navigation.navigate(MATTERMOST_DOCS_ROUTE, {
                        openInNewTab: true,
                      });
                    }}
                  />,
                  <MoreMenuItem
                    key="uninstall"
                    text="Disconnect Mattermost"
                    icon={IconProp.Trash}
                    isDestructive={true}
                    dataTestId="mattermost-uninstall"
                    onClick={() => {
                      setUninstallError("");
                      setIsUninstallConfirmOpen(true);
                    }}
                  />,
                ]}
              </CardMoreMenu>,
            ]}
          />
        </div>
      )}

      <div
        data-testid="mattermost-your-account"
        className={isProjectConnected && !props.hideProjectCards ? "mt-6" : ""}
      >
        <Card
          title={accountTitle}
          description={accountDescription}
          buttons={accountButtons}
        />
        {sendLinkError && !isUsernameFormOpen ? (
          <div className="mt-3">
            <ErrorMessage message={sendLinkError} />
          </div>
        ) : (
          <></>
        )}
      </div>

      {/*
       * The teams of the server OneUptime works in: every team its bot is a
       * member of, the default one marked (MattermostTeams).
       */}
      {isProjectConnected && !props.hideProjectCards && (
        <MattermostTeamsCard
          className="mt-6"
          onTeamsChange={(description: MattermostTeamsDescription) => {
            setConnectedTeams(description);
          }}
        />
      )}

      {isConnectFormOpen ? (
        <BasicFormModal<JSONObject>
          title={CONNECT_WITH_MATTERMOST_TITLE}
          description={CONNECT_FORM_DESCRIPTION}
          name="Settings > Mattermost > Connect"
          isLoading={isConnecting}
          error={connectError || undefined}
          submitButtonText="Connect"
          onClose={() => {
            setIsConnectFormOpen(false);
            setConnectError("");
          }}
          onSubmit={(values: JSONObject) => {
            submitConnectForm(values).catch((err: Exception) => {
              setConnectError(API.getFriendlyErrorMessage(err));
            });
          }}
          formProps={{
            id: "connect-mattermost-form",
            fields: [
              {
                field: { serverUrl: true },
                title: "Server address",
                description:
                  "The address you open Mattermost at, for example https://chat.example.com.",
                fieldType: FormFieldSchemaType.Text,
                required: true,
                placeholder: "https://chat.example.com",
              },
              {
                field: { accessToken: true },
                title: "Bot access token",
                description:
                  "In Mattermost, go to Integrations → Bot Accounts, add a bot for OneUptime and copy its access token. Then add the bot to your team.",
                fieldType: FormFieldSchemaType.Password,
                required: true,
              },
            ],
          }}
        />
      ) : (
        <></>
      )}

      {teams.length > 1 && connectValues ? (
        <BasicFormModal<JSONObject>
          title={CHOOSE_TEAM_TITLE}
          description={CHOOSE_TEAM_DESCRIPTION}
          name="Settings > Mattermost > Choose Team"
          isLoading={isConnecting}
          error={connectError || undefined}
          submitButtonText="Connect"
          onClose={() => {
            setTeams([]);
            setConnectValues(null);
            setConnectError("");
          }}
          onSubmit={(values: JSONObject) => {
            submitTeam(values).catch((err: Exception) => {
              setConnectError(API.getFriendlyErrorMessage(err));
            });
          }}
          formProps={{
            id: "choose-mattermost-team-form",
            fields: [
              {
                field: { teamId: true },
                title: DEFAULT_TEAM_TITLE,
                fieldType: FormFieldSchemaType.Dropdown,
                required: true,
                dropdownOptions: teams.map((team: MattermostTeamOption) => {
                  return {
                    label: team.displayName || team.name,
                    value: team.id,
                  };
                }),
              },
            ],
          }}
        />
      ) : (
        <></>
      )}

      {isUsernameFormOpen ? (
        <BasicFormModal<JSONObject>
          title={SEND_LINK_TITLE}
          description={CONNECT_YOUR_MATTERMOST_ACCOUNT_DESCRIPTION}
          name="Settings > Mattermost > Send Link"
          isLoading={isSendingLink}
          error={sendLinkError || undefined}
          submitButtonText="Send link"
          onClose={() => {
            setIsUsernameFormOpen(false);
            setSendLinkError("");
          }}
          onSubmit={(values: JSONObject) => {
            sendLink(String(values["username"] || "").trim() || null).catch(
              (err: Exception) => {
                setSendLinkError(API.getFriendlyErrorMessage(err));
              },
            );
          }}
          formProps={{
            id: "send-mattermost-link-form",
            initialValues: {
              username: suggestedUsername || "",
            },
            fields: [
              {
                field: { username: true },
                title: "Mattermost username",
                description: "Your username in Mattermost, as in @alice.",
                fieldType: FormFieldSchemaType.Text,
                required: true,
                placeholder: "alice",
              },
            ],
          }}
        />
      ) : (
        <></>
      )}

      {isUninstallConfirmOpen && isProjectConnected ? (
        <UninstallWorkspaceConfirm
          workspaceName="Mattermost"
          isUninstalling={isUninstalling}
          error={uninstallError}
          onClose={() => {
            setIsUninstallConfirmOpen(false);
            setUninstallError("");
          }}
          onConfirm={() => {
            uninstall().catch((err: Exception) => {
              setUninstallError(API.getFriendlyErrorMessage(err));
            });
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default MattermostIntegration;
