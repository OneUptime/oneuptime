import CodeRepositoryType from "./CodeRepositoryType";

/*
 * What Code's connect dialog and its server routes say to each other
 * (/code-repository-connection/*, CodeRepositoryConnectionAPI). Never a
 * token: the dialog sends one, and nothing sends one back.
 */

export const CODE_REPOSITORY_CONNECTION_API_PATH: string =
  "/code-repository-connection";

// The account an access token acts as, as its server names it.
export interface CodeHostAccountJSON {
  login: string;
  name: string;
}

// A repository the token reaches, for the picker.
export interface CodeHostListedRepositoryJSON {
  // The server's own id for it.
  id: string;
  name: string;
  ownerPath: string;
  fullName: string;
  description?: string | undefined;
  defaultBranch: string;
  webUrl: string;
  isPrivate: boolean;
  // Whether the token may push to it: one it may only read is not offered.
  canPush: boolean;
  // Already one of the project's repositories, through this server.
  isConnected: boolean;
}

export interface CodeHostRepositoryListJSON {
  account: CodeHostAccountJSON;
  // The server's address, as OneUptime keeps it.
  hostUrl: string;
  // "Forgejo" or "Gitea", for a Forgejo-family server.
  hostProduct?: string | undefined;
  repositories: Array<CodeHostListedRepositoryJSON>;
  hasMore: boolean;
}

export interface CodeHostConnectResultJSON {
  connectionId: string;
  // New repositories.
  imported: number;
  // The project's repositories already there, now on this connection.
  reconnected: number;
  // Ones that could not be connected (no push access, gone, names too long).
  skipped: number;
  repositoryIds: Array<string>;
}

/*
 * A Git repository's connection: the repository, or - for an address
 * OneUptime's server may not reach - a question first: connect it anyway,
 * for a Runner of the project's own on its network to work in?
 */
export interface GitRepositoryConnectResultJSON {
  repositoryId?: string | undefined;
  needsConfirmation?: boolean | undefined;
  message?: string | undefined;
}

// One of the project's connections, as the dialog offers it again.
export interface CodeHostConnectionJSON {
  id: string;
  provider: CodeRepositoryType;
  hostUrl: string;
  hostProduct?: string | undefined;
  accountLogin?: string | undefined;
  credentialHint?: string | undefined;
  isTokenRefused: boolean;
  isReachableFromServer: boolean;
  repositoryCount: number;
}
