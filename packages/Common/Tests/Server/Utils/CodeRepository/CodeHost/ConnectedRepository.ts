import { jest } from "@jest/globals";
import CodeRepositoryService from "../../../../../Server/Services/CodeRepositoryService";
import CodeRepositoryConnectionService, {
  Service as CodeRepositoryConnectionServiceClass,
} from "../../../../../Server/Services/CodeRepositoryConnectionService";
import CodeHostAccess from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostAccess";
import CodeRepository from "../../../../../Models/DatabaseModels/CodeRepository";
import CodeRepositoryConnection from "../../../../../Models/DatabaseModels/CodeRepositoryConnection";
import URL from "../../../../../Types/API/URL";
import CodeRepositoryType from "../../../../../Types/CodeRepository/CodeRepositoryType";
import ObjectID from "../../../../../Types/ObjectID";
import { FakeCodeHost, FakeRoute, fakeCodeHost } from "./FakeCodeHost";

/*
 * A GitLab or Forgejo repository connected to a project, the way the
 * server reads one - its row and its connection, read as root - with the
 * host's API faked at the transport (FakeCodeHost). What reads it goes the
 * whole real way: CodeHostAccess reads the row's connection, checks it is
 * the project's and usable, builds GitLabApi or ForgejoApi with its token,
 * and marks the connection refused when the server refuses the token.
 *
 * Not a test file itself (jest only collects *.test.ts). Call
 * disconnectRepository() after each test.
 */

export const CONNECTED_PROJECT_ID: ObjectID = new ObjectID(
  "c0de0000-0000-4000-8000-000000000001",
);
export const CONNECTED_REPOSITORY_ID: ObjectID = new ObjectID(
  "c0de0000-0000-4000-8000-000000000002",
);
export const CONNECTION_ID: ObjectID = new ObjectID(
  "c0de0000-0000-4000-8000-000000000003",
);
export const CONNECTED_TOKEN: string = "connected-token-0000000000000001";

export interface ConnectedRepository {
  repository: CodeRepository;
  connection: CodeRepositoryConnection;
  host: FakeCodeHost;
  // How many times the server refused the token, and answered after.
  refused: () => number;
  accepted: () => number;
}

export function connectRepository(data: {
  provider: CodeRepositoryType.GitLab | CodeRepositoryType.Forgejo;
  routes: Array<FakeRoute>;
  repository?: Partial<CodeRepository> | undefined;
  connection?: Partial<CodeRepositoryConnection> | undefined;
}): ConnectedRepository {
  const isGitLab: boolean = data.provider === CodeRepositoryType.GitLab;
  const hostUrl: string = isGitLab
    ? "https://gitlab.example.com"
    : "https://git.example.com";

  const connection: CodeRepositoryConnection = new CodeRepositoryConnection();
  connection._id = CONNECTION_ID.toString();
  connection.projectId = CONNECTED_PROJECT_ID;
  connection.provider = data.provider;
  connection.hostUrl = hostUrl;
  if (!isGitLab) {
    connection.hostProduct = "Forgejo";
  }
  connection.accountLogin = "oneuptime-bot";
  connection.credentials =
    CodeRepositoryConnectionServiceClass.writeCredentials({
      token: CONNECTED_TOKEN,
      username: "oneuptime-bot",
    });
  connection.isReachableFromServer = true;
  Object.assign(connection, data.connection || {});

  const repository: CodeRepository = new CodeRepository();
  repository._id = CONNECTED_REPOSITORY_ID.toString();
  repository.projectId = CONNECTED_PROJECT_ID;
  repository.name = "checkout";
  repository.repositoryHostedAt = data.provider;
  repository.organizationName = "acme";
  repository.repositoryName = "checkout";
  repository.mainBranchName = "main";
  repository.repositoryUrl = URL.fromString(`${hostUrl}/acme/checkout`);
  if (isGitLab) {
    repository.gitLabProjectId = "4217";
  }
  repository.codeRepositoryConnectionId = CONNECTION_ID;
  Object.assign(repository, data.repository || {});

  const host: FakeCodeHost = fakeCodeHost({
    apiBaseUrl: `${hostUrl}${isGitLab ? "/api/v4" : "/api/v1"}`,
    routes: data.routes,
  });

  let refused: number = 0;
  let accepted: number = 0;

  jest
    .spyOn(CodeRepositoryService, "findOneBy")
    .mockImplementation((async () => {
      return repository;
    }) as never);
  jest
    .spyOn(CodeRepositoryConnectionService, "findBy")
    .mockImplementation((async () => {
      return [connection];
    }) as never);
  jest
    .spyOn(CodeRepositoryConnectionService, "markRefused")
    .mockImplementation((async () => {
      refused++;
    }) as never);
  jest
    .spyOn(CodeRepositoryConnectionService, "markAccepted")
    .mockImplementation((async () => {
      accepted++;
    }) as never);

  CodeHostAccess.setTransportForTests(host.transport);

  return {
    repository,
    connection,
    host,
    refused: (): number => {
      return refused;
    },
    accepted: (): number => {
      return accepted;
    },
  };
}

export function disconnectRepository(): void {
  CodeHostAccess.setTransportForTests(null);
  jest.restoreAllMocks();
}
