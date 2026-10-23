import CodeConnectApi from "./CodeConnectApi";
import {
  CODE_CONNECT_COPY,
  CODE_HOST_GITHUB_ONLY_NOTE,
  CODE_REPOSITORY_CONNECTION_COPY,
  getCodeHostName,
  getHostLabel,
} from "./CodeHostCopy";
import RepositoryConnectionStatus from "../CodeRepository/RepositoryConnectionStatus";
import {
  getCodeConnectLock,
  GitHubConnectLock,
} from "../CodeRepository/GitHubConnectLock";
import {
  CodeTaskRepositoryConnectionJSON,
  CodeTaskRepositoryJSON,
} from "Common/Types/AI/CodeTask";
import { CodeHost } from "Common/Types/CodeRepository/CodeHost";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import Exception from "Common/Types/Exception/Exception";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

export const CODE_REPOSITORY_CONNECTION_TEST_ID: string =
  "code-repository-connection";

export interface ComponentProps {
  /*
   * The repository as Code reads it (CodeApi.getRepository): where it is
   * hosted and how its connection stands - never its token.
   */
  repository: CodeTaskRepositoryJSON;
  // The token was replaced: the page reads the repository again.
  onReplaced: () => void;
}

/*
 * The facts under a connection's status, joined as one quiet line: its
 * server, the account the token acts as, and the token's last characters.
 * React-free words, so App's tests read them.
 */
export const getConnectionFacts: (data: {
  provider: CodeRepositoryType;
  connection: CodeTaskRepositoryConnectionJSON | undefined;
  translator: Translator;
}) => Array<string> = (data: {
  provider: CodeRepositoryType;
  connection: CodeTaskRepositoryConnectionJSON | undefined;
  translator: Translator;
}): Array<string> => {
  const connection: CodeTaskRepositoryConnectionJSON | undefined =
    data.connection;

  if (!connection) {
    return [];
  }

  return [
    connection.hostUrl ? getHostLabel(connection.hostUrl) : "",
    connection.accountLogin
      ? data.translator.translateTemplate(
          CODE_REPOSITORY_CONNECTION_COPY.account,
          { account: connection.accountLogin },
        )
      : "",
    connection.credentialHint
      ? data.translator.translateTemplate(
          data.provider === CodeRepositoryType.Git
            ? CODE_REPOSITORY_CONNECTION_COPY.gitCredentialHint
            : CODE_REPOSITORY_CONNECTION_COPY.tokenHint,
          { hint: `…${connection.credentialHint}` },
        )
      : "",
  ].filter((part: string): boolean => {
    return Boolean(part);
  });
};

/*
 * How a repository that is not on GitHub connects, in its Settings'
 * Repository Details: its host's mark and whether the connection works,
 * the server, the account and the token's last characters, and - where
 * something is wrong - what it means: its token refused (replace it), its
 * connection gone (connect it again from Repositories), or a Git server
 * only one of the project's own Runners reaches - and, in one quiet line,
 * what works in GitHub repositories only (commands from comments and
 * production reviews; on a Git server, the pull request itself).
 *
 * Replace access token asks for the new token (and, for a Git server, the
 * username) in a dialog; the server checks it with the Git server before
 * it keeps it, and every repository on the connection uses it from then
 * on. Locked, with why, for someone who may not connect repositories - the
 * server asks the same.
 */
const CodeRepositoryConnection: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const provider: CodeRepositoryType = CodeHost.readType(
    props.repository.provider,
  );
  const connection: CodeTaskRepositoryConnectionJSON | undefined =
    props.repository.connection;
  const hostName: string = getCodeHostName({
    provider,
    hostProduct: connection?.hostProduct,
  });
  const lock: GitHubConnectLock = getCodeConnectLock();

  const [isReplacing, setIsReplacing] = useState<boolean>(false);
  const [isReplaced, setIsReplaced] = useState<boolean>(false);

  const facts: Array<string> = getConnectionFacts({
    provider,
    connection,
    translator,
  });

  return (
    <div
      data-testid={CODE_REPOSITORY_CONNECTION_TEST_ID}
      data-provider={provider}
      className="space-y-2"
    >
      <RepositoryConnectionStatus
        provider={provider}
        hostProduct={connection?.hostProduct}
        isReachable={props.repository.isConnected}
        isTokenRefused={connection?.isTokenRefused}
      />
      {facts.length > 0 ? (
        <p
          data-testid="code-repository-connection-facts"
          className="break-words text-sm text-gray-600"
        >
          {facts.join(" · ")}
        </p>
      ) : (
        <></>
      )}
      {connection?.isTokenRefused ? (
        <p
          data-testid="code-repository-connection-refused"
          className="text-sm leading-6 text-amber-800"
        >
          {translator.translateTemplate(
            CODE_REPOSITORY_CONNECTION_COPY.tokenRefusedHelp,
            { host: hostName },
          )}
        </p>
      ) : !connection?.id ? (
        <p
          data-testid="code-repository-connection-gone"
          className="text-sm leading-6 text-amber-800"
        >
          {translator.translateText(
            CODE_REPOSITORY_CONNECTION_COPY.connectionGone,
          )}
        </p>
      ) : (
        <></>
      )}
      {connection?.id && connection.isReachableFromServer === false ? (
        <p
          data-testid="code-repository-connection-runner-only"
          className="text-sm leading-6 text-gray-600"
        >
          {translator.translateText(
            CODE_REPOSITORY_CONNECTION_COPY.notReachableFromServer,
          )}
        </p>
      ) : (
        <></>
      )}
      {provider !== CodeRepositoryType.GitHub ? (
        <p
          data-testid="code-repository-github-only"
          className="text-sm leading-6 text-gray-500"
        >
          {translator.translateText(CODE_HOST_GITHUB_ONLY_NOTE[provider])}
        </p>
      ) : (
        <></>
      )}
      {isReplaced ? (
        <p
          role="status"
          data-testid="code-repository-connection-replaced"
          className="text-sm font-medium text-green-700"
        >
          {translator.translateText(
            CODE_REPOSITORY_CONNECTION_COPY.replacedNotice,
          )}
        </p>
      ) : (
        <></>
      )}
      {connection?.id ? (
        lock.isLocked ? (
          <p
            data-testid="code-repository-connection-locked"
            className="text-sm leading-6 text-gray-500"
          >
            {lock.reason}
          </p>
        ) : (
          <button
            type="button"
            data-testid="code-repository-replace-token"
            onClick={() => {
              setIsReplaced(false);
              setIsReplacing(true);
            }}
            className="inline-flex items-center rounded-md bg-white px-2.5 py-1.5 text-sm font-medium text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            {translator.translateText(
              CODE_REPOSITORY_CONNECTION_COPY.replaceButton,
            )}
          </button>
        )
      ) : (
        <></>
      )}
      {isReplacing && connection?.id ? (
        <ReplaceTokenDialog
          connectionId={connection.id}
          provider={provider}
          hostName={hostName}
          onClose={() => {
            setIsReplacing(false);
          }}
          onReplaced={() => {
            setIsReplacing(false);
            setIsReplaced(true);
            props.onReplaced();
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

/*
 * The new token - and, for a Git server, the username Git signs in with,
 * kept as it is when left empty. Whatever the server refuses is said in
 * the dialog, in its words, and keeps what was typed.
 */
const ReplaceTokenDialog: FunctionComponent<{
  connectionId: string;
  provider: CodeRepositoryType;
  hostName: string;
  onClose: () => void;
  onReplaced: () => void;
}> = (props: {
  connectionId: string;
  provider: CodeRepositoryType;
  hostName: string;
  onClose: () => void;
  onReplaced: () => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const isGit: boolean = props.provider === CodeRepositoryType.Git;

  const [token, setToken] = useState<string>("");
  const [username, setUsername] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const replace: () => Promise<void> = async (): Promise<void> => {
    if (!token.trim()) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await CodeConnectApi.replaceToken({
        connectionId: props.connectionId,
        token: token,
        ...(isGit && username.trim() ? { username: username.trim() } : {}),
      });
      props.onReplaced();
    } catch (err) {
      setError(API.getFriendlyErrorMessage(err as Exception));
      setIsLoading(false);
    }
  };

  return (
    <Modal
      title={translator.translateTemplate(
        CODE_REPOSITORY_CONNECTION_COPY.replaceTitle,
      )}
      description={translator.translateTemplate(
        CODE_REPOSITORY_CONNECTION_COPY.replaceDescription,
        { host: props.hostName },
      )}
      modalWidth={ModalWidth.Medium}
      onClose={props.onClose}
      onSubmit={() => {
        void replace();
      }}
      submitButtonText={translator.translateText(
        CODE_REPOSITORY_CONNECTION_COPY.replaceSubmit,
      )}
      isLoading={isLoading}
      disableSubmitButton={!token.trim()}
      error={error || undefined}
    >
      <div data-testid="code-replace-token-dialog" className="space-y-4">
        {isGit ? (
          <div>
            <FieldLabelElement
              title={CODE_CONNECT_COPY.gitUsernameTitle}
              htmlFor="code-replace-token-username"
              required={false}
              description={CODE_REPOSITORY_CONNECTION_COPY.replaceUsernameHelp}
            />
            <div className="mt-2">
              <Input
                id="code-replace-token-username"
                dataTestId="code-replace-token-username"
                value={username}
                disableSpellCheck={true}
                autoComplete="off"
                onChange={(value: string) => {
                  setUsername(value);
                }}
              />
            </div>
          </div>
        ) : (
          <></>
        )}
        <div>
          <FieldLabelElement
            title={
              isGit
                ? CODE_CONNECT_COPY.gitPasswordTitle
                : CODE_REPOSITORY_CONNECTION_COPY.replaceTokenTitle
            }
            htmlFor="code-replace-token-input"
            required={true}
            description={CODE_REPOSITORY_CONNECTION_COPY.replaceTokenHelp}
          />
          <div className="mt-2">
            <Input
              id="code-replace-token-input"
              dataTestId="code-replace-token-input"
              type={InputType.PASSWORD}
              value={token}
              disableSpellCheck={true}
              onChange={(value: string) => {
                setToken(value);
              }}
              onEnterPress={() => {
                void replace();
              }}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default CodeRepositoryConnection;
