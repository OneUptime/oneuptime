import ProjectUtil from "Common/UI/Utils/Project";
import Route from "Common/Types/API/Route";
import Link from "Common/UI/Components/Link/Link";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import { APP_API_URL, env } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  getGitHubConnectLock,
  getGitHubConnectPlanReason,
  GitHubConnectLock,
} from "../CodeRepository/GitHubConnectLock";
import ConnectCallbackNotice, {
  ConnectCallbackNoticeState,
  useConnectCallbackNotice,
} from "../Workspace/ConnectCallbackNotice";
import ConnectCallbackUtil, {
  CONNECT_NOTICE_QUERY_PARAM,
  ConnectProviderNotice,
  ConnectProvider,
} from "Common/Types/Workspace/ConnectCallback";
import {
  GITHUB_INSTALLATION_CHOICE_QUERY_PARAM,
  GitHubInstallationChoice,
} from "Common/Types/CodeRepository/GitHubInstallationChoice";
import Modal from "Common/UI/Components/Modal/Modal";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import URL from "Common/Types/API/URL";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import Exception from "Common/Types/Exception/Exception";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import { CodeOtherHosts } from "./CodeHostChoices";

/*
 * CONNECTING GITHUB, FROM CODE.
 *
 * Installing the GitHub App imports every repository of the installation
 * into the project and keeps them in step through webhooks - that is how
 * repositories get into Code. This file holds the whole flow, moved here
 * from the old Code Repositories page:
 *
 *   - Connect GitHub: asks the server for the install URL (through the API
 *     class, so an expired session is refreshed and the request replayed,
 *     and a refusal comes back here to be shown on the page instead of on a
 *     bare error page), then goes there.
 *   - Connect an existing installation: for an account that already has the
 *     app - installing again only opens its settings on GitHub. Signing in
 *     to GitHub tells the server which installations the person manages.
 *   - What GitHub sends the browser back with: installation_id (connected),
 *     a choice of installations, the app installed straight from GitHub, or
 *     an error (ConnectCallbackNotice).
 *
 * Someone who may not connect (permission, plan) sees the card locked with
 * one sentence saying why (GitHubConnectLock). A server with no GitHub App
 * says so, with the variables to set and the guide.
 */

export interface UseGitHubConnect {
  isGitHubAppConfigured: boolean;
  connectLock: GitHubConnectLock;
  connect: () => void;
  connectExisting: () => void;
  // Everything the page shows about a connection in progress, in one place.
  notices: ReactElement;
}

export interface UseGitHubConnectOptions {
  // GitHub sent the browser back with a new installation: refresh the list.
  onConnected: () => void;
}

export const useGitHubConnect: (
  options: UseGitHubConnectOptions,
) => UseGitHubConnect = (
  options: UseGitHubConnectOptions,
): UseGitHubConnect => {
  const translator: Translator = useTranslator();
  const [showGitHubConnectedBanner, setShowGitHubConnectedBanner] =
    useState<boolean>(false);
  /*
   * The app was installed on GitHub itself - from its Marketplace listing or
   * its page - and GitHub sent the browser back here (?notice=). Nothing is
   * connected yet: the notice offers to connect the installation.
   */
  const [showGitHubInstalledNotice, setShowGitHubInstalledNotice] =
    useState<boolean>(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  /*
   * The GitHub installations a sign-in found, when the person's GitHub
   * account manages more than one (?github_installations=): they pick the
   * one to connect. `installations` is null while it loads.
   */
  const [installationChoice, setInstallationChoice] = useState<{
    token: string;
    installations: Array<GitHubInstallationChoice> | null;
    error: string | null;
  } | null>(null);

  /*
   * What an installation that came back unmade says (?error=): GitHub sends
   * the browser back here either way.
   */
  const connectCallback: ConnectCallbackNoticeState = useConnectCallbackNotice({
    provider: ConnectProvider.GitHub,
    planRequiredMessage: getGitHubConnectPlanReason(),
  });

  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  /*
   * Set while the click waits for the install URL, so a double click does
   * not start two connections. A ref, not state: the second click can land
   * before a re-render would have shown this handler a state flag.
   */
  const isConnectingToGitHubRef: MutableRefObject<boolean> =
    useRef<boolean>(false);

  // Reads the installations a sign-in found, to offer them.
  const loadInstallationChoice: (token: string) => Promise<void> = async (
    token: string,
  ): Promise<void> => {
    setInstallationChoice({ token: token, installations: null, error: null });

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get<JSONObject>({
          url: URL.fromURL(APP_API_URL)
            .addRoute("/github/installation-choices")
            .addQueryParam("choice", token, true),
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      setInstallationChoice({
        token: token,
        installations: ((response.data as JSONObject)["installations"] ||
          []) as JSONArray as unknown as Array<GitHubInstallationChoice>,
        error: null,
      });
    } catch (error) {
      setInstallationChoice({
        token: token,
        installations: [],
        error: API.getFriendlyErrorMessage(error as Exception),
      });
    }
  };

  /*
   * Connects the installation picked. The browser goes back through the
   * callback with the choice's one-use state, which connects it only if it
   * was offered, and returns here.
   */
  const connectPickedInstallation: (installationId: string) => void = (
    installationId: string,
  ): void => {
    if (!installationChoice) {
      return;
    }

    Navigation.navigate(
      URL.fromURL(APP_API_URL)
        .addRoute("/github/auth/callback")
        .addQueryParam("state", installationChoice.token, true)
        .addQueryParam("installation_id", installationId, true),
    );
  };

  /*
   * Connect an installation the app already has on GitHub. Installing again
   * cannot: GitHub shows that installation's settings and sends nobody back.
   * The server answers GitHub's sign-in URL instead, and signing in tells it
   * which installations the person's GitHub account manages.
   */
  const handleConnectExistingInstallation: () => Promise<void> =
    async (): Promise<void> => {
      if (!projectId || isConnectingToGitHubRef.current) {
        return;
      }

      isConnectingToGitHubRef.current = true;
      setConnectError(null);

      let authorizeUrl: string | undefined = undefined;

      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.get<JSONObject>({
            url: URL.fromURL(APP_API_URL).addRoute(
              "/github/connect-existing-url",
            ),
            headers: ModelAPI.getCommonHeaders(),
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        authorizeUrl = (response.data as JSONObject)["authorizeUrl"] as
          | string
          | undefined;

        if (!authorizeUrl) {
          throw new Error(
            translator.translateText(
              "OneUptime could not start the GitHub connection. Please try again.",
            ),
          );
        }
      } catch (error) {
        setConnectError(API.getFriendlyErrorMessage(error as Exception));
      }

      isConnectingToGitHubRef.current = false;

      if (authorizeUrl) {
        Navigation.navigate(URL.fromString(authorizeUrl));
      }
    };

  useEffect(() => {
    /*
     * Check for installation_id in URL query params (returned from GitHub
     * after installing the app). The repositories in the installation were
     * already imported server-side by the install callback, so all that is
     * left to do here is show a success banner and refresh the list. A
     * sign-in that found several installations comes back with a choice to
     * offer instead.
     */
    const urlParams: URLSearchParams = new URLSearchParams(
      window.location.search,
    );
    const installationId: string | null = urlParams.get("installation_id");
    const choiceToken: string | null = urlParams.get(
      GITHUB_INSTALLATION_CHOICE_QUERY_PARAM,
    );
    const installedOnGitHub: boolean =
      ConnectCallbackUtil.readNotice(
        ConnectProvider.GitHub,
        urlParams.get(CONNECT_NOTICE_QUERY_PARAM),
      ) === ConnectProviderNotice.GitHubInstalled;

    if (installationId) {
      setShowGitHubConnectedBanner(true);
      options.onConnected();
    }

    if (choiceToken) {
      void loadInstallationChoice(choiceToken);
    }

    if (installedOnGitHub) {
      setShowGitHubInstalledNotice(true);
    }

    if (installationId || choiceToken || installedOnGitHub) {
      // Clean up the URL
      const newUrl: string = window.location.pathname;
      window.history.replaceState({}, document.title, newUrl);
    }
  }, []);

  const handleConnectWithGitHub: () => Promise<void> =
    async (): Promise<void> => {
      if (!projectId || isConnectingToGitHubRef.current) {
        return;
      }

      isConnectingToGitHubRef.current = true;
      setConnectError(null);

      /*
       * Install (or update) the GitHub App: once installed, every repository
       * in the installation is imported and kept in sync by webhooks.
       *
       * The server is asked for the installation URL through the API class,
       * as the Slack and Microsoft Teams connections ask for theirs. The
       * project goes in its tenant header, an expired session is refreshed
       * and the request replayed, and a refusal - no permission to add code
       * repositories, a plan without them - comes back here to be shown on
       * the page instead of on a bare error page. The URL carries a one-use
       * state the server recorded for this person, project and browser.
       */
      let installUrl: string | undefined = undefined;

      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.get<JSONObject>({
            url: URL.fromURL(APP_API_URL).addRoute("/github/install-url"),
            headers: ModelAPI.getCommonHeaders(),
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        installUrl = (response.data as JSONObject)["installUrl"] as
          | string
          | undefined;

        if (!installUrl) {
          throw new Error(
            translator.translateText(
              "OneUptime could not start the GitHub connection. Please try again.",
            ),
          );
        }
      } catch (error) {
        setConnectError(API.getFriendlyErrorMessage(error as Exception));
      }

      /*
       * Released before navigating, so a page the browser restores from its
       * back/forward cache (Back from GitHub) does not come back with a
       * button that ignores clicks.
       */
      isConnectingToGitHubRef.current = false;

      if (installUrl) {
        Navigation.navigate(URL.fromString(installUrl));
      }
    };

  // Read GitHub App Name fresh on each render to avoid module initialization timing issues
  const gitHubAppName: string | null = env("GITHUB_APP_NAME") || null;
  const isGitHubAppConfigured: boolean = Boolean(gitHubAppName);

  // Locked, with one sentence, for someone who may not connect it.
  const connectLock: GitHubConnectLock = getGitHubConnectLock();

  /*
   * Each with the space under it that ConnectCallbackNotice keeps, so none
   * sits on the page's first card: Repositories draws them in a plain box.
   */
  const notices: ReactElement = (
    <>
      {showGitHubConnectedBanner && (
        <Alert
          type={AlertType.SUCCESS}
          className="mb-5"
          dataTestId="github-connected-notice"
          strongTitle="GitHub connected"
          title="Your repositories were imported. Pick one to ask AI to work in it."
          onClose={() => {
            setShowGitHubConnectedBanner(false);
          }}
        />
      )}

      {/*
       * Only for someone who may connect it: anyone else sees the card's own
       * sentence for what connecting needs.
       */}
      {showGitHubInstalledNotice && !connectLock.isLocked && (
        <Alert
          type={AlertType.INFO}
          className="mb-5"
          dataTestId="github-installed-notice"
          strongTitle="The GitHub App is installed"
          title={
            <TranslatedSentence
              template="{{connectInstallation}} to import its repositories into this project."
              slots={{
                connectInstallation: (
                  <button
                    type="button"
                    className="font-medium underline"
                    onClick={() => {
                      setShowGitHubInstalledNotice(false);
                      void handleConnectExistingInstallation();
                    }}
                  >
                    {translator.translateText("Connect the installation")}
                  </button>
                ),
              }}
            />
          }
          onClose={() => {
            setShowGitHubInstalledNotice(false);
          }}
        />
      )}

      <ConnectCallbackNotice state={connectCallback} />

      {connectError && (
        <Alert
          type={AlertType.DANGER}
          className="mb-5"
          dataTestId="github-connect-error"
          title={connectError}
          onClose={() => {
            setConnectError(null);
          }}
        />
      )}

      {installationChoice && (
        <Modal
          title="Choose the GitHub account to connect"
          description="Your GitHub account manages the app on more than one account. Pick the one whose repositories this project should use."
          isBodyLoading={installationChoice.installations === null}
          error={installationChoice.error || undefined}
          onClose={() => {
            setInstallationChoice(null);
          }}
          secondaryButton={{
            title: "Install on another account",
            onClick: () => {
              setInstallationChoice(null);
              void handleConnectWithGitHub();
            },
          }}
        >
          <ul
            data-testid="github-installation-choices"
            className="divide-y divide-gray-200 rounded-md border border-gray-200"
          >
            {(installationChoice.installations || []).map(
              (choice: GitHubInstallationChoice) => {
                return (
                  <li key={choice.installationId}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50"
                      onClick={() => {
                        connectPickedInstallation(choice.installationId);
                      }}
                    >
                      <span className="font-medium text-gray-900">
                        {choice.accountLogin}
                      </span>
                      <span className="text-sm text-gray-500">
                        {choice.accountType === "Organization"
                          ? translator.translateText("Organization")
                          : translator.translateText("Personal account")}
                      </span>
                    </button>
                  </li>
                );
              },
            )}
          </ul>
        </Modal>
      )}
    </>
  );

  return {
    isGitHubAppConfigured,
    connectLock,
    connect: (): void => {
      void handleConnectWithGitHub();
    },
    connectExisting: (): void => {
      void handleConnectExistingInstallation();
    },
    notices,
  };
};

// The GitHub mark, drawn in place (no network font for one icon).
export const GitHubMark: FunctionComponent<{
  className?: string | undefined;
}> = (props: { className?: string | undefined }): ReactElement => {
  return (
    <svg
      className={props.className || "h-5 w-5"}
      fill="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
        clipRule="evenodd"
      />
    </svg>
  );
};

/*
 * Code's first page with no repository yet: what Code is for, in one
 * sentence, and the one thing to do - connect GitHub, the place Code does
 * the most in, with the GitHub App. The button is a real button, locked
 * with one sentence for someone who may not connect. Under it, the other
 * places a repository can be: GitLab, Forgejo or Gitea, and any Git server
 * (CodeOtherHosts), each opening Code's connect dialog at its step - and on
 * a server with no GitHub App, the way to connect at all: there they come
 * first, under a mark that is not GitHub's, and what GitHub needs on the
 * server follows them, as the way to add it.
 */
export const ConnectGitHubEmptyState: FunctionComponent<{
  connection: UseGitHubConnect;
  // Connect a repository that is not on GitHub, from the host picked.
  onConnectOtherHost?: ((provider: CodeRepositoryType) => void) | undefined;
}> = (props: {
  connection: UseGitHubConnect;
  onConnectOtherHost?: ((provider: CodeRepositoryType) => void) | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const connectLock: GitHubConnectLock = props.connection.connectLock;
  // No GitHub App here: the other hosts are how to connect, so they lead.
  const areOtherHostsFirst: boolean = Boolean(
    props.onConnectOtherHost && !props.connection.isGitHubAppConfigured,
  );
  const otherHosts: ReactElement = props.onConnectOtherHost ? (
    <CodeOtherHosts
      isAfterGitHub={props.connection.isGitHubAppConfigured}
      onChoose={props.onConnectOtherHost}
    />
  ) : (
    <></>
  );

  return (
    <div
      data-testid="code-connect-github"
      className="rounded-2xl border border-gray-200 bg-white px-6 py-12 text-center shadow-sm sm:px-12"
    >
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-900 text-white">
        {areOtherHostsFirst ? (
          <Icon icon={IconProp.Code} className="h-7 w-7" />
        ) : (
          <GitHubMark className="h-7 w-7" />
        )}
      </div>
      <h2 className="mt-5 text-lg font-semibold text-gray-900">
        {translator.translateText("Connect your code")}
      </h2>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-gray-500">
        {translator.translateText(
          props.onConnectOtherHost
            ? "Connect your repositories and ask OneUptime AI to work in them: fix a bug, write tests, explain the code. It opens a pull request for you to review."
            : "Connect GitHub and ask OneUptime AI to work in your repositories: fix a bug, write tests, explain the code. It opens a pull request for you to review.",
        )}
      </p>

      {areOtherHostsFirst ? otherHosts : <></>}

      {props.connection.isGitHubAppConfigured ? (
        <div className="mt-6 flex flex-col items-center gap-3">
          <button
            type="button"
            id="connect-github-app"
            disabled={connectLock.isLocked}
            aria-describedby={
              connectLock.isLocked ? "connect-github-app-lock" : undefined
            }
            onClick={() => {
              props.connection.connect();
            }}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
              connectLock.isLocked
                ? "cursor-not-allowed bg-gray-100 text-gray-400"
                : "bg-gray-900 text-white hover:bg-gray-800"
            }`}
          >
            <GitHubMark className="h-4 w-4" />
            {translator.translateText("Connect GitHub")}
          </button>

          {connectLock.isLocked ? (
            <div
              id="connect-github-app-lock"
              className="flex items-center gap-1.5 text-sm text-gray-600"
            >
              <Icon
                icon={IconProp.Lock}
                className="h-4 w-4 flex-none text-gray-400"
              />
              <span>{connectLock.reason}</span>
            </div>
          ) : (
            <p
              data-testid="connect-existing-github-installation"
              className="text-sm text-gray-500"
            >
              <TranslatedSentence
                template="Already installed the app on GitHub? {{connectExisting}}"
                slots={{
                  connectExisting: (
                    <button
                      type="button"
                      className="font-medium text-indigo-600 underline hover:text-indigo-500"
                      onClick={() => {
                        props.connection.connectExisting();
                      }}
                    >
                      {translator.translateText(
                        "Connect an existing installation",
                      )}
                    </button>
                  ),
                }}
              />
            </p>
          )}
        </div>
      ) : (
        <div
          data-testid="code-github-not-configured"
          className={`mx-auto max-w-lg rounded-lg border border-gray-200 bg-gray-50 p-4 text-left ${
            areOtherHostsFirst ? "mt-8" : "mt-6"
          }`}
        >
          <h3 className="text-sm font-semibold text-gray-900">
            {translator.translateText(
              "GitHub App is not configured on this server",
            )}
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            <TranslatedSentence
              template={
                props.onConnectOtherHost
                  ? "Connecting GitHub requires the GitHub App environment variables (like {{appName}} and {{appId}}) to be configured on your OneUptime server. See the {{documentation}} for setup instructions."
                  : "Connecting a repository requires the GitHub App environment variables (like {{appName}} and {{appId}}) to be configured on your OneUptime server. See the {{documentation}} for setup instructions."
              }
              slots={{
                appName: <code>GITHUB_APP_NAME</code>,
                appId: <code>GITHUB_APP_ID</code>,
                documentation: (
                  <Link
                    to={Route.fromString(
                      "/docs/self-hosted/github-integration",
                    )}
                    openInNewTab={true}
                    className="underline"
                  >
                    {translator.translateText(
                      "GitHub Integration documentation",
                    )}
                  </Link>
                ),
              }}
            />
          </p>
        </div>
      )}

      {areOtherHostsFirst ? <></> : otherHosts}
    </div>
  );
};
