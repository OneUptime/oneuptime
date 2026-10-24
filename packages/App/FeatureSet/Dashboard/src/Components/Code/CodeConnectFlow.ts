import type { CodeConnectSource } from "./CodeConnectApi";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import {
  CodeHostUrl,
  CodeHostUrlError,
  MAX_ACCESS_TOKEN_LENGTH,
  MAX_REPOSITORIES_PER_CONNECT,
} from "Common/Types/CodeRepository/CodeHost";
import {
  CodeHostConnectionJSON,
  CodeHostListedRepositoryJSON,
} from "Common/Types/CodeRepository/CodeHostConnect";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The connect dialog's rules, React-free: which step comes next, what the
 * token form sends, and which repositories may be picked - so the dialog,
 * its tests and App's tests read the same ones. The server checks every
 * one of them again (CodeRepositoryConnector); these only say early, in
 * the dialog, what it would refuse.
 */

export enum CodeConnectStep {
  // Where is your code?
  Choose = "choose",
  // GitLab, Forgejo or Gitea: a server and a token, or a connection.
  Token = "token",
  // The repositories the token can push to, to pick.
  Pick = "pick",
  // Any Git server: a repository's address and credentials.
  Git = "git",
}

export const CODE_CONNECT_FORM_ERRORS: {
  noServer: string;
  noToken: string;
  tokenTooLong: string;
  tokenHasSpaces: string;
} = {
  noServer: translationKey("Enter the server's address."),
  noToken: translationKey("Paste the access token."),
  tokenTooLong: translationKey("That access token is too long to be one."),
  tokenHasSpaces: translationKey(
    "The access token cannot hold spaces or line breaks. Paste it again.",
  ),
};

/*
 * What a server's address is refused with before anything is sent
 * (CodeHostUrl.normalizeHostUrl's own sentences), as keys, so the dialog
 * says them in the reader's language. A test holds them to the rules' own
 * words.
 */
export const CODE_HOST_URL_REFUSALS: Array<string> = [
  translationKey("That address is too long."),
  translationKey(
    "That is not a web address. Enter it as https://git.example.com.",
  ),
  translationKey(
    "Leave the username and password out of the address. The access token goes in its own field.",
  ),
  translationKey("Use the server's https address."),
];

// A host whose repositories connect with an access token.
export const isTokenProvider: (provider: CodeRepositoryType) => boolean = (
  provider: CodeRepositoryType,
): boolean => {
  return (
    provider === CodeRepositoryType.GitLab ||
    provider === CodeRepositoryType.Forgejo
  );
};

export const getTokenProviderOf: (
  provider: CodeRepositoryType,
) => CodeRepositoryType.GitLab | CodeRepositoryType.Forgejo = (
  provider: CodeRepositoryType,
): CodeRepositoryType.GitLab | CodeRepositoryType.Forgejo => {
  return provider === CodeRepositoryType.Forgejo
    ? CodeRepositoryType.Forgejo
    : CodeRepositoryType.GitLab;
};

/*
 * What the token step sends: a connection the project has, or the server's
 * address - as OneUptime keeps it - and the token. Or why it cannot yet.
 */
export const readTokenForm: (data: {
  provider: CodeRepositoryType.GitLab | CodeRepositoryType.Forgejo;
  connectionId: string | null;
  hostUrl: string;
  token: string;
  allowHttp?: boolean | undefined;
}) => { source: CodeConnectSource } | { error: string } = (data: {
  provider: CodeRepositoryType.GitLab | CodeRepositoryType.Forgejo;
  connectionId: string | null;
  hostUrl: string;
  token: string;
  allowHttp?: boolean | undefined;
}): { source: CodeConnectSource } | { error: string } => {
  if (data.connectionId) {
    return { source: { connectionId: data.connectionId } };
  }

  if (!data.hostUrl.trim()) {
    return { error: CODE_CONNECT_FORM_ERRORS.noServer };
  }

  let hostUrl: string;

  try {
    // http is the server's to refuse: a self-hosted OneUptime may allow it.
    hostUrl = CodeHostUrl.normalizeHostUrl(data.hostUrl, { allowHttp: true });
  } catch (error) {
    return {
      error:
        error instanceof CodeHostUrlError
          ? error.message
          : CODE_CONNECT_FORM_ERRORS.noServer,
    };
  }

  const token: string = data.token.trim();

  if (!token) {
    return { error: CODE_CONNECT_FORM_ERRORS.noToken };
  }

  if (token.length > MAX_ACCESS_TOKEN_LENGTH) {
    return { error: CODE_CONNECT_FORM_ERRORS.tokenTooLong };
  }

  for (let index: number = 0; index < token.length; index++) {
    const code: number = token.charCodeAt(index);

    if (code < 33 || code === 127) {
      return { error: CODE_CONNECT_FORM_ERRORS.tokenHasSpaces };
    }
  }

  return {
    source: { provider: data.provider, hostUrl, token },
  };
};

/*
 * The connection a token step starts on: the project's first one to the
 * host whose token its server still takes - coming back to connect more
 * repositories from the same server is why most people open the step
 * again - or none, for a new token. A refused one is offered, not picked.
 */
export const getDefaultConnectionId: (
  connections: Array<CodeHostConnectionJSON> | null,
  provider: CodeRepositoryType | null,
) => string | null = (
  connections: Array<CodeHostConnectionJSON> | null,
  provider: CodeRepositoryType | null,
): string | null => {
  const usable: CodeHostConnectionJSON | undefined = (connections || []).find(
    (connection: CodeHostConnectionJSON): boolean => {
      return connection.provider === provider && !connection.isTokenRefused;
    },
  );

  return usable ? usable.id : null;
};

/*
 * The host a Git repository's address names, as the dialog says it when
 * OneUptime cannot reach it ("git.example.com:8443"), or "" for an address
 * that names none.
 */
export const getGitAddressHost: (address: string) => string = (
  address: string,
): string => {
  try {
    return CodeHostUrl.readGitRemoteUrl(address, { allowHttp: true }).host;
  } catch {
    return "";
  }
};

/*
 * The repositories that may be picked: those the token can push to and the
 * project does not have yet.
 */
export const getConnectableIds: (
  repositories: Array<CodeHostListedRepositoryJSON>,
) => Array<string> = (
  repositories: Array<CodeHostListedRepositoryJSON>,
): Array<string> => {
  return repositories
    .filter((repository: CodeHostListedRepositoryJSON): boolean => {
      return repository.canPush && !repository.isConnected;
    })
    .map((repository: CodeHostListedRepositoryJSON): string => {
      return repository.id;
    });
};

/*
 * A pick, toggled: on or off, never more than the server connects at once
 * (the last pick past the limit is not taken).
 */
export const toggleSelection: (
  selected: Array<string>,
  id: string,
) => Array<string> = (selected: Array<string>, id: string): Array<string> => {
  if (selected.includes(id)) {
    return selected.filter((picked: string): boolean => {
      return picked !== id;
    });
  }

  if (selected.length >= MAX_REPOSITORIES_PER_CONNECT) {
    return selected;
  }

  return [...selected, id];
};
