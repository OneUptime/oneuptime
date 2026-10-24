import CodeHostMark from "../Code/CodeHostMark";
import { CodeHost } from "Common/Types/CodeRepository/CodeHost";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export const REPOSITORY_CONNECTION_STATUS_TEST_ID: string =
  "repository-connection-status";

export interface ComponentProps {
  gitHubAppInstallationId?: string | null | undefined;
  /*
   * Whether the project's GitHub App reaches the repository now, as Code's
   * Repositories reads it (CodeTaskGate.getReachableRepositoryIds): false
   * draws it Not connected - where Repositories folds it - rather than a
   * connection AI cannot work through. Unknown (not read yet, or a read
   * that failed) says how it connects, as it always did.
   */
  isReachable?: boolean | null | undefined;
  /*
   * Where the repository is hosted (CodeRepositoryType). One that is not on
   * GitHub - GitLab, Forgejo, Gitea, a Git server - connects with an access
   * token (or a Git password) through its connection, drawn with its
   * host's mark. Unknown is GitHub, as every repository was before.
   */
  provider?: string | undefined;
  // For a Forgejo-family server: "Forgejo" or "Gitea", for its mark.
  hostProduct?: string | undefined;
  /*
   * Its Git server refused the connection's token: Token refused - replace
   * it to connect again - rather than Not connected.
   */
  isTokenRefused?: boolean | undefined;
}

const GITHUB_MARK_PATH: string =
  "M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z";

const RepositoryConnectionStatus: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const gitHubMark: ReactElement = (
    <svg
      className="h-3.5 w-3.5"
      fill="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path fillRule="evenodd" d={GITHUB_MARK_PATH} clipRule="evenodd" />
    </svg>
  );

  const provider: CodeRepositoryType = CodeHost.readType(props.provider);

  /*
   * A repository on another host: its host's mark, and how its connection
   * stands - its token refused, its connection gone, or an access token
   * that works.
   */
  if (provider !== CodeRepositoryType.GitHub) {
    const hostMark: ReactElement = (
      <CodeHostMark
        provider={provider}
        hostProduct={props.hostProduct}
        className="h-3.5 w-3.5"
      />
    );

    if (props.isTokenRefused) {
      return (
        <div
          className="flex items-center space-x-2"
          data-testid={REPOSITORY_CONNECTION_STATUS_TEST_ID}
          data-connection="token-refused"
          data-provider={provider}
        >
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-gray-500">
            {hostMark}
          </div>
          <div className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-600/20">
            <Icon icon={IconProp.LinkSlash} className="h-3 w-3" />
            <span>{translator.translateText("Token refused")}</span>
          </div>
        </div>
      );
    }

    if (props.isReachable === false) {
      return (
        <div
          className="flex items-center space-x-2"
          data-testid={REPOSITORY_CONNECTION_STATUS_TEST_ID}
          data-connection="not-connected"
          data-provider={provider}
        >
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-gray-500">
            {hostMark}
          </div>
          <div className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-600/20">
            <Icon icon={IconProp.LinkSlash} className="h-3 w-3" />
            <span>{translator.translateText("Not connected")}</span>
          </div>
        </div>
      );
    }

    return (
      <div
        className="flex items-center space-x-2"
        data-testid={REPOSITORY_CONNECTION_STATUS_TEST_ID}
        data-connection="access-token"
        data-provider={provider}
      >
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-900 text-white">
          {hostMark}
        </div>
        <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20">
          {translator.translateText("Access Token")}
        </span>
      </div>
    );
  }

  /*
   * The GitHub App does not reach it: the installation that imported it is
   * gone or no longer gives OneUptime access to it - or it was never
   * connected through the app, which AI needs. Drawn as Code draws such a
   * repository: its mark grey, and Not connected.
   */
  if (props.isReachable === false) {
    return (
      <div
        className="flex items-center space-x-2"
        data-testid={REPOSITORY_CONNECTION_STATUS_TEST_ID}
        data-connection="not-connected"
      >
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-gray-500">
          {gitHubMark}
        </div>
        <div className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-600/20">
          <Icon icon={IconProp.LinkSlash} className="h-3 w-3" />
          <span>{translator.translateText("Not connected")}</span>
        </div>
      </div>
    );
  }

  if (props.gitHubAppInstallationId) {
    return (
      <div
        className="flex items-center space-x-2"
        data-testid={REPOSITORY_CONNECTION_STATUS_TEST_ID}
        data-connection="github-app"
      >
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-900 text-white">
          {gitHubMark}
        </div>
        <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20">
          {translator.translateText("GitHub App")}
        </span>
      </div>
    );
  }

  // If not connected via GitHub App, it's via access token
  return (
    <div
      className="flex items-center space-x-2"
      data-testid={REPOSITORY_CONNECTION_STATUS_TEST_ID}
      data-connection="access-token"
    >
      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth="2"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z"
          />
        </svg>
      </div>
      <span className="inline-flex items-center rounded-full bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-500/10">
        {translator.translateText("Access Token")}
      </span>
    </div>
  );
};

export default RepositoryConnectionStatus;
