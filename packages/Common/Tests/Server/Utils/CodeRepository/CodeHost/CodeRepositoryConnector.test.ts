import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import CodeRepositoryConnector from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeRepositoryConnector";
import CodeHostAccess from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostAccess";
import {
  CodeHostHttpError,
  CodeHostHttpErrorKind,
  CodeHostHttpRequest,
  CodeHostHttpResponse,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostHttp";
import CodeRepositoryService, {
  Service as CodeRepositoryServiceClass,
} from "../../../../../Server/Services/CodeRepositoryService";
import CodeRepositoryConnectionService, {
  Service as CodeRepositoryConnectionServiceClass,
} from "../../../../../Server/Services/CodeRepositoryConnectionService";
import CodeRepository from "../../../../../Models/DatabaseModels/CodeRepository";
import CodeRepositoryConnection from "../../../../../Models/DatabaseModels/CodeRepositoryConnection";
import CodeRepositoryType from "../../../../../Types/CodeRepository/CodeRepositoryType";
import {
  CodeHostConnectResultJSON,
  CodeHostRepositoryListJSON,
  GitRepositoryConnectResultJSON,
} from "../../../../../Types/CodeRepository/CodeHostConnect";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import { FakeCodeHost, fakeCodeHost } from "./FakeCodeHost";

/*
 * Connecting repositories that are not on GitHub, from Code's dialog -
 * over a project's rows kept in memory and a Git server's API faked at the
 * transport:
 *
 *   - the server is asked who the token is before anything is listed or
 *     kept, and a refused token is said, in words;
 *   - the repositories picked are read again from the server by their own
 *     id, never taken from the request, and one the token cannot push to
 *     is not connected;
 *   - one token is one connection: connecting more with it, or connecting
 *     again, reuses it, and a repository the project already has from the
 *     server moves onto it;
 *   - a Git repository is checked with Git's own protocol; one OneUptime
 *     cannot reach is asked about first, and connected for a project
 *     Runner only when the person says so;
 *   - a replaced token is checked first, and clears a refusal.
 *
 * Nothing it answers carries a token.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "a1b2c3d4-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "a1b2c3d4-0000-4000-8000-000000000002",
);
const USER_ID: ObjectID = new ObjectID("a1b2c3d4-0000-4000-8000-000000000003");
const TOKEN: string = "forgejo-token-0000000000000001";
const NEW_TOKEN: string = "forgejo-token-0000000000000002";
const HOST: string = "https://git.example.com";

let connections: Array<CodeRepositoryConnection> = [];
let repositories: Array<CodeRepository> = [];
let forge: FakeCodeHost;
let acceptedTokens: Array<string> = [];

function sameId(a: unknown, b: unknown): boolean {
  return String(a ?? "") === String(b ?? "");
}

function forgejoRepository(
  id: number,
  name: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    name,
    full_name: `acme/${name}`,
    owner: { login: "acme" },
    description: `The ${name}`,
    default_branch: "main",
    html_url: `${HOST}/acme/${name}`,
    clone_url: `${HOST}/acme/${name}.git`,
    private: true,
    permissions: { push: true },
    ...overrides,
  };
}

const REMOTE: Record<number, Record<string, unknown>> = {
  11: forgejoRepository(11, "checkout"),
  12: forgejoRepository(12, "billing"),
  13: forgejoRepository(13, "readonly", { permissions: { push: false } }),
};

beforeEach(() => {
  connections = [];
  repositories = [];
  acceptedTokens = [TOKEN];

  forge = fakeCodeHost({
    apiBaseUrl: `${HOST}/api/v1`,
    routes: [
      {
        method: "GET",
        path: "/user",
        answer: (request: CodeHostHttpRequest) => {
          const token: string = (
            request.headers["Authorization"] || ""
          ).replace("token ", "");

          return acceptedTokens.includes(token)
            ? { json: { id: 5, login: "alice", full_name: "Alice" } }
            : { status: 401, json: { message: "invalid token" } };
        },
      },
      {
        method: "GET",
        path: "/version",
        answer: () => {
          return { json: { version: "9.0.3+gitea-1.22.0" } };
        },
      },
      {
        method: "GET",
        path: "/repos/search",
        answer: () => {
          return {
            json: { data: Object.values(REMOTE) },
            headers: { "x-total-count": "3" },
          };
        },
      },
      {
        method: "GET",
        path: /^\/repositories\/\d+$/,
        answer: (_request: CodeHostHttpRequest, url: URL) => {
          const id: number = Number(url.pathname.split("/").pop());

          return REMOTE[id]
            ? { json: REMOTE[id] }
            : { status: 404, json: { message: "not found" } };
        },
      },
    ],
  });

  jest
    .spyOn(CodeRepositoryConnector, "getTransport")
    .mockReturnValue(forge.transport);

  jest
    .spyOn(CodeRepositoryConnectionService, "findBy")
    .mockImplementation((async (args: {
      query: Record<string, unknown>;
    }): Promise<Array<CodeRepositoryConnection>> => {
      return connections.filter((connection: CodeRepositoryConnection) => {
        return (
          sameId(connection.projectId, args.query["projectId"]) &&
          (args.query["provider"] === undefined ||
            connection.provider === args.query["provider"]) &&
          (args.query["hostUrl"] === undefined ||
            connection.hostUrl === args.query["hostUrl"])
        );
      });
    }) as never);

  jest
    .spyOn(CodeRepositoryConnectionService, "findOneBy")
    .mockImplementation((async (args: {
      query: Record<string, unknown>;
    }): Promise<CodeRepositoryConnection | null> => {
      return (
        connections.find((connection: CodeRepositoryConnection) => {
          return (
            sameId(connection.id, args.query["_id"]) &&
            sameId(connection.projectId, args.query["projectId"])
          );
        }) || null
      );
    }) as never);

  jest
    .spyOn(CodeRepositoryConnectionService, "create")
    .mockImplementation((async (args: {
      data: CodeRepositoryConnection;
    }): Promise<CodeRepositoryConnection> => {
      args.data._id = ObjectID.generate().toString();
      connections.push(args.data);
      return args.data;
    }) as never);

  jest
    .spyOn(CodeRepositoryConnectionService, "updateOneById")
    .mockImplementation((async (args: {
      id: ObjectID;
      data: Record<string, unknown>;
    }): Promise<void> => {
      const connection: CodeRepositoryConnection | undefined = connections.find(
        (each: CodeRepositoryConnection) => {
          return sameId(each.id, args.id);
        },
      );

      Object.assign(connection!, args.data);
    }) as never);

  jest
    .spyOn(CodeRepositoryConnectionService, "markAccepted")
    .mockResolvedValue(undefined);
  jest
    .spyOn(CodeRepositoryConnectionService, "markRefused")
    .mockImplementation((async (
      connection: CodeRepositoryConnection,
    ): Promise<void> => {
      connection.refusedAt = new Date();
    }) as never);
  jest
    .spyOn(CodeRepositoryConnectionService, "deleteUnusedConnections")
    .mockResolvedValue(0);

  jest.spyOn(CodeRepositoryService, "findBy").mockImplementation((async (args: {
    query: Record<string, unknown>;
  }): Promise<Array<CodeRepository>> => {
    return repositories.filter((repository: CodeRepository) => {
      return (
        sameId(repository.projectId, args.query["projectId"]) &&
        (args.query["repositoryHostedAt"] === undefined ||
          repository.repositoryHostedAt === args.query["repositoryHostedAt"])
      );
    });
  }) as never);

  jest
    .spyOn(CodeRepositoryService, "findOneBy")
    .mockImplementation((async (args: {
      query: Record<string, unknown>;
    }): Promise<CodeRepository | null> => {
      return (
        repositories.find((repository: CodeRepository) => {
          return (
            sameId(repository.projectId, args.query["projectId"]) &&
            sameId(
              repository.codeRepositoryConnectionId,
              args.query["codeRepositoryConnectionId"],
            )
          );
        }) || null
      );
    }) as never);

  jest.spyOn(CodeRepositoryService, "create").mockImplementation((async (args: {
    data: CodeRepository;
  }): Promise<CodeRepository> => {
    args.data._id = ObjectID.generate().toString();
    repositories.push(args.data);
    return args.data;
  }) as never);

  jest
    .spyOn(CodeRepositoryService, "updateOneById")
    .mockImplementation((async (args: {
      id: ObjectID;
      data: Record<string, unknown>;
    }): Promise<void> => {
      const repository: CodeRepository | undefined = repositories.find(
        (each: CodeRepository) => {
          return sameId(each.id, args.id);
        },
      );

      Object.assign(repository!, args.data);
    }) as never);

  jest
    .spyOn(CodeRepositoryServiceClass, "getNewRepositoryDefaults")
    .mockResolvedValue({
      isGitHubCommandsEnabled: true,
      isProductionReviewEnabled: true,
      runnerId: null,
    } as never);

  jest
    .spyOn(CodeHostAccess, "countRepositoriesByConnection")
    .mockImplementation((async (args: {
      connectionIds: Array<string>;
    }): Promise<Map<string, number>> => {
      const counts: Map<string, number> = new Map();

      for (const id of args.connectionIds) {
        counts.set(
          id,
          repositories.filter((repository: CodeRepository) => {
            return sameId(repository.codeRepositoryConnectionId, id);
          }).length,
        );
      }

      return counts;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const SOURCE: {
  provider: CodeRepositoryType;
  hostUrl: string;
  token: string;
} = {
  provider: CodeRepositoryType.Forgejo,
  hostUrl: HOST,
  token: TOKEN,
};

function json(value: unknown): string {
  return JSON.stringify(value);
}

describe("reading what the dialog sends", () => {
  test("a pasted token is kept as typed, refused when it holds spaces or is too long", () => {
    expect(CodeRepositoryConnector.readToken("  abc123  ")).toBe("abc123");
    expect(() => {
      return CodeRepositoryConnector.readToken("");
    }).toThrow("Paste the access token.");
    expect(() => {
      return CodeRepositoryConnector.readToken("abc def");
    }).toThrow("cannot hold spaces or line breaks");
    expect(() => {
      return CodeRepositoryConnector.readToken("x".repeat(5000));
    }).toThrow("too long");
    expect(() => {
      return CodeRepositoryConnector.readUsername("a:b");
    }).toThrow("colon");
  });

  test("a source is a connection of the project's or a server and a token, never anything else", () => {
    expect(
      CodeRepositoryConnector.readSource({
        provider: "Forgejo",
        hostUrl: "git.example.com/",
        token: TOKEN,
      }),
    ).toEqual(SOURCE);
    expect(() => {
      return CodeRepositoryConnector.readSource({
        provider: "GitHub",
        hostUrl: HOST,
        token: TOKEN,
      });
    }).toThrow(BadDataException);
    expect(() => {
      return CodeRepositoryConnector.readSource({ connectionId: "not-a-uuid" });
    }).toThrow("not one of this project's");
  });
});

describe("listing the repositories a token reaches", () => {
  test("asks the server who the token is, then lists what it can push to, each marked when the project has it", async () => {
    const listed: CodeHostRepositoryListJSON =
      await CodeRepositoryConnector.listRepositories({
        projectId: PROJECT_ID,
        source: SOURCE,
      });

    expect(forge.requests[0]!.url).toBe(`${HOST}/api/v1/user`);
    expect(listed.account).toEqual({ login: "alice", name: "Alice" });
    expect(listed.hostProduct).toBe("Forgejo");
    expect(
      listed.repositories.map(
        (repository: {
          fullName: string;
          canPush: boolean;
          isConnected: boolean;
        }) => {
          return [
            repository.fullName,
            repository.canPush,
            repository.isConnected,
          ];
        },
      ),
    ).toEqual([
      ["acme/checkout", true, false],
      ["acme/billing", true, false],
      ["acme/readonly", false, false],
    ]);
    expect(json(listed)).not.toContain(TOKEN);
    // Nothing is kept for a listing.
    expect(connections).toHaveLength(0);
  });

  test("a refused token is said, and nothing is listed or kept", async () => {
    await expect(
      CodeRepositoryConnector.listRepositories({
        projectId: PROJECT_ID,
        source: { ...SOURCE, token: "wrong-token-0000000000" },
      }),
    ).rejects.toMatchObject({ kind: CodeHostHttpErrorKind.Unauthorized });
    expect(forge.urlsTo("/repos/search")).toHaveLength(0);
    expect(connections).toHaveLength(0);
  });
});

describe("connecting the repositories picked", () => {
  test("keeps one connection for the token, and the repositories as the server says they are", async () => {
    const result: CodeHostConnectResultJSON =
      await CodeRepositoryConnector.connect({
        projectId: PROJECT_ID,
        userId: USER_ID,
        source: SOURCE,
        repositoryIds: ["11", "12", "13", "not-an-id", "11"],
      });

    expect(result.imported).toBe(2);
    expect(result.reconnected).toBe(0);
    // The read-only one and the id that is not one.
    expect(result.skipped).toBe(2);
    expect(json(result)).not.toContain(TOKEN);

    // Each was read again from the server by its own id.
    expect(
      forge.requests
        .map((request: CodeHostHttpRequest): string => {
          return new URL(request.url).pathname;
        })
        .filter((path: string): boolean => {
          return path.startsWith("/api/v1/repositories/");
        }),
    ).toEqual([
      "/api/v1/repositories/11",
      "/api/v1/repositories/12",
      "/api/v1/repositories/13",
    ]);

    expect(connections).toHaveLength(1);

    const connection: CodeRepositoryConnection = connections[0]!;

    expect(connection.provider).toBe(CodeRepositoryType.Forgejo);
    expect(connection.hostUrl).toBe(HOST);
    expect(connection.hostProduct).toBe("Forgejo");
    expect(connection.accountLogin).toBe("alice");
    expect(connection.credentialHint).toBe(TOKEN.substring(TOKEN.length - 4));
    expect(connection.isReachableFromServer).toBe(true);
    expect(
      CodeRepositoryConnectionServiceClass.readCredentials(
        connection.credentials,
      ),
    ).toEqual({ token: TOKEN, username: "alice" });

    expect(
      repositories.map((repository: CodeRepository) => {
        return [
          repository.name,
          repository.organizationName,
          repository.repositoryName,
          repository.repositoryHostedAt,
          repository.mainBranchName,
          repository.repositoryUrl?.toString(),
          repository.isGitHubCommandsEnabled,
          repository.isProductionReviewEnabled,
          sameId(repository.codeRepositoryConnectionId, connection.id),
        ];
      }),
    ).toEqual([
      /*
       * Commands from comments are GitHub's: off. Production review is on,
       * as it is for a repository the GitHub App connects: Forgejo's pull
       * requests are reviewed too.
       */
      [
        "checkout",
        "acme",
        "checkout",
        CodeRepositoryType.Forgejo,
        "main",
        `${HOST}/acme/checkout`,
        false,
        true,
        true,
      ],
      [
        "billing",
        "acme",
        "billing",
        CodeRepositoryType.Forgejo,
        "main",
        `${HOST}/acme/billing`,
        false,
        true,
        true,
      ],
    ]);
  });

  test("connecting again with the same token reuses its connection and keeps the repositories already there", async () => {
    await CodeRepositoryConnector.connect({
      projectId: PROJECT_ID,
      userId: USER_ID,
      source: SOURCE,
      repositoryIds: ["11"],
    });

    const again: CodeHostConnectResultJSON =
      await CodeRepositoryConnector.connect({
        projectId: PROJECT_ID,
        userId: USER_ID,
        source: SOURCE,
        repositoryIds: ["11", "12"],
      });

    expect(connections).toHaveLength(1);
    expect(again.connectionId).toBe(connections[0]!.id!.toString());
    expect(again.imported).toBe(1);
    expect(repositories).toHaveLength(2);

    // The listing now marks both as the project's.
    const listed: CodeHostRepositoryListJSON =
      await CodeRepositoryConnector.listRepositories({
        projectId: PROJECT_ID,
        source: { connectionId: connections[0]!.id!.toString() },
      });

    expect(
      listed.repositories
        .filter((repository: { isConnected: boolean }) => {
          return repository.isConnected;
        })
        .map((repository: { fullName: string }) => {
          return repository.fullName;
        }),
    ).toEqual(["acme/checkout", "acme/billing"]);
  });

  test("a new token for the same server moves the project's repository onto its connection, keeping the row", async () => {
    await CodeRepositoryConnector.connect({
      projectId: PROJECT_ID,
      userId: USER_ID,
      source: SOURCE,
      repositoryIds: ["11"],
    });

    const rowId: string = repositories[0]!.id!.toString();

    acceptedTokens.push(NEW_TOKEN);

    const moved: CodeHostConnectResultJSON =
      await CodeRepositoryConnector.connect({
        projectId: PROJECT_ID,
        userId: USER_ID,
        source: { ...SOURCE, token: NEW_TOKEN },
        repositoryIds: ["11"],
      });

    expect(connections).toHaveLength(2);
    expect(moved.reconnected).toBe(1);
    expect(moved.imported).toBe(0);
    expect(repositories).toHaveLength(1);
    expect(repositories[0]!.id!.toString()).toBe(rowId);
    expect(
      sameId(repositories[0]!.codeRepositoryConnectionId, moved.connectionId),
    ).toBe(true);
  });

  test("none the token can push to connects nothing, and says why", async () => {
    await expect(
      CodeRepositoryConnector.connect({
        projectId: PROJECT_ID,
        userId: USER_ID,
        source: SOURCE,
        repositoryIds: ["13"],
      }),
    ).rejects.toThrow("cannot push to them");
    expect(connections).toHaveLength(0);
    expect(repositories).toHaveLength(0);
  });

  test("a connection is only its own project's", async () => {
    await CodeRepositoryConnector.connect({
      projectId: PROJECT_ID,
      userId: USER_ID,
      source: SOURCE,
      repositoryIds: ["11"],
    });

    await expect(
      CodeRepositoryConnector.listRepositories({
        projectId: OTHER_PROJECT_ID,
        source: { connectionId: connections[0]!.id!.toString() },
      }),
    ).rejects.toThrow("not one of this project's");
  });

  test("a stored token the server now refuses marks its connection refused", async () => {
    await CodeRepositoryConnector.connect({
      projectId: PROJECT_ID,
      userId: USER_ID,
      source: SOURCE,
      repositoryIds: ["11"],
    });

    acceptedTokens = [];

    await expect(
      CodeRepositoryConnector.listRepositories({
        projectId: PROJECT_ID,
        source: { connectionId: connections[0]!.id!.toString() },
      }),
    ).rejects.toBeInstanceOf(CodeHostHttpError);
    expect(connections[0]!.refusedAt).toBeInstanceOf(Date);
  });
});

describe("replacing a connection's token", () => {
  test("checks the new token with the server first, then keeps it and clears the refusal", async () => {
    await CodeRepositoryConnector.connect({
      projectId: PROJECT_ID,
      userId: USER_ID,
      source: SOURCE,
      repositoryIds: ["11"],
    });

    const connection: CodeRepositoryConnection = connections[0]!;
    connection.refusedAt = new Date();

    await expect(
      CodeRepositoryConnector.replaceToken({
        projectId: PROJECT_ID,
        connectionId: connection.id!.toString(),
        token: "not-taken-000000000000",
        username: undefined,
      }),
    ).rejects.toMatchObject({ kind: CodeHostHttpErrorKind.Unauthorized });
    // A refused new token changes nothing.
    expect(
      CodeRepositoryConnectionServiceClass.readCredentials(
        connection.credentials,
      )?.token,
    ).toBe(TOKEN);

    acceptedTokens = [NEW_TOKEN];

    const replaced: { accountLogin: string | null; credentialHint: string } =
      await CodeRepositoryConnector.replaceToken({
        projectId: PROJECT_ID,
        connectionId: connection.id!.toString(),
        token: NEW_TOKEN,
        username: undefined,
      });

    expect(replaced).toEqual({
      accountLogin: "alice",
      credentialHint: NEW_TOKEN.substring(NEW_TOKEN.length - 4),
    });
    expect(json(replaced)).not.toContain(NEW_TOKEN);
    expect(
      CodeRepositoryConnectionServiceClass.readCredentials(
        connection.credentials,
      ),
    ).toEqual({ token: NEW_TOKEN, username: "alice" });
    expect(connection.refusedAt).toBeNull();
  });
});

describe("connecting a Git repository", () => {
  const sha: string = "c".repeat(40);
  const advertisement: string = [
    "001e# service=git-upload-pack\n",
    "0000",
    `${(`${sha} HEAD\0symref=HEAD:refs/heads/trunk\n`.length + 4).toString(16).padStart(4, "0")}${sha} HEAD\0symref=HEAD:refs/heads/trunk\n`,
    `${(`${sha} refs/heads/trunk\n`.length + 4).toString(16).padStart(4, "0")}${sha} refs/heads/trunk\n`,
    "0000",
  ].join("");

  test("checks it with Git's own protocol, and keeps it with its main branch", async () => {
    const seen: Array<CodeHostHttpRequest> = [];

    jest
      .spyOn(CodeRepositoryConnector, "getTransport")
      .mockReturnValue(
        async (request: CodeHostHttpRequest): Promise<CodeHostHttpResponse> => {
          seen.push(request);

          return {
            statusCode: 200,
            bodyText: advertisement,
            bodyJson: undefined,
            headers: {
              "content-type": "application/x-git-upload-pack-advertisement",
            },
          };
        },
      );

    const result: GitRepositoryConnectResultJSON =
      await CodeRepositoryConnector.connectGitRepository({
        projectId: PROJECT_ID,
        userId: USER_ID,
        url: "https://git.example.com/team/app.git",
        username: "deploy",
        password: "git-password-0000000001",
        connectWithoutCheck: false,
      });

    expect(result.repositoryId).toBeTruthy();
    expect(result.needsConfirmation).toBeUndefined();
    expect(seen[0]!.url).toBe(
      "https://git.example.com/team/app.git/info/refs?service=git-upload-pack",
    );
    expect(repositories[0]!.mainBranchName).toBe("trunk");
    expect(repositories[0]!.repositoryHostedAt).toBe(CodeRepositoryType.Git);
    // A Git server has no pull requests to review, nor commands to answer.
    expect(repositories[0]!.isProductionReviewEnabled).toBe(false);
    expect(repositories[0]!.isGitHubCommandsEnabled).toBe(false);
    expect(repositories[0]!.repositoryUrl?.toString()).toBe(
      "https://git.example.com/team/app.git",
    );
    expect(connections[0]!.isReachableFromServer).toBe(true);
    expect(
      CodeRepositoryConnectionServiceClass.readCredentials(
        connections[0]!.credentials,
      ),
    ).toEqual({ token: "git-password-0000000001", username: "deploy" });

    // The same address again is refused: it is connected already.
    await expect(
      CodeRepositoryConnector.connectGitRepository({
        projectId: PROJECT_ID,
        userId: USER_ID,
        url: "https://GIT.example.com/team/app.git",
        username: "deploy",
        password: "git-password-0000000001",
        connectWithoutCheck: false,
      }),
    ).rejects.toThrow("connected already");
  });

  test("one OneUptime may not reach is asked about first, and connected for a project Runner only when the person says so", async () => {
    jest
      .spyOn(CodeRepositoryConnector, "getTransport")
      .mockReturnValue(async (): Promise<CodeHostHttpResponse> => {
        throw new CodeHostHttpError({
          kind: CodeHostHttpErrorKind.NotAllowed,
          message: "Git server host 10.0.0.5 is not allowed",
        });
      });

    const asked: GitRepositoryConnectResultJSON =
      await CodeRepositoryConnector.connectGitRepository({
        projectId: PROJECT_ID,
        userId: USER_ID,
        url: "https://10.0.0.5/team/app.git",
        username: "",
        password: "git-password-0000000001",
        connectWithoutCheck: false,
      });

    expect(asked.needsConfirmation).toBe(true);
    /*
     * The host, so a typo shows, then what Connect anyway does - the words
     * Code's dialog says it in. Why the policy refused it stays out.
     */
    expect(asked.message).toBe(
      "OneUptime cannot reach 10.0.0.5. Check the address. If the server is on a private network, connect it anyway and pick one of your own Runners on that network to work in it.",
    );
    expect(asked.message).not.toContain("is not allowed");
    expect(connections).toHaveLength(0);

    const connected: GitRepositoryConnectResultJSON =
      await CodeRepositoryConnector.connectGitRepository({
        projectId: PROJECT_ID,
        userId: USER_ID,
        url: "https://10.0.0.5/team/app.git",
        username: "",
        password: "git-password-0000000001",
        connectWithoutCheck: true,
      });

    expect(connected.repositoryId).toBeTruthy();
    expect(connections[0]!.isReachableFromServer).toBe(false);
    // Nothing was read from it: its main branch is the default.
    expect(repositories[0]!.mainBranchName).toBe("main");
  });

  test("refused credentials are said, and nothing is kept", async () => {
    jest
      .spyOn(CodeRepositoryConnector, "getTransport")
      .mockReturnValue(async (): Promise<CodeHostHttpResponse> => {
        return {
          statusCode: 401,
          bodyText: "",
          bodyJson: undefined,
          headers: {},
        };
      });

    await expect(
      CodeRepositoryConnector.connectGitRepository({
        projectId: PROJECT_ID,
        userId: USER_ID,
        url: "https://git.example.com/team/app.git",
        username: "deploy",
        password: "wrong-password-000001",
        connectWithoutCheck: false,
      }),
    ).rejects.toMatchObject({ kind: CodeHostHttpErrorKind.Unauthorized });
    expect(connections).toHaveLength(0);
    expect(repositories).toHaveLength(0);
  });

  test("an SSH address is refused with what to use instead", async () => {
    await expect(
      CodeRepositoryConnector.connectGitRepository({
        projectId: PROJECT_ID,
        userId: USER_ID,
        url: "git@git.example.com:team/app.git",
        username: "",
        password: "git-password-0000000001",
        connectWithoutCheck: false,
      }),
    ).rejects.toThrow("over HTTPS");
  });
});

describe("the project's connections, as the dialog offers them again", () => {
  test("say the server, the account and the token's last characters - never the token", async () => {
    await CodeRepositoryConnector.connect({
      projectId: PROJECT_ID,
      userId: USER_ID,
      source: SOURCE,
      repositoryIds: ["11", "12"],
    });

    const listed: Array<Record<string, unknown>> =
      (await CodeRepositoryConnector.listConnections(PROJECT_ID)) as never;

    expect(listed).toEqual([
      {
        id: connections[0]!.id!.toString(),
        provider: CodeRepositoryType.Forgejo,
        hostUrl: HOST,
        hostProduct: "Forgejo",
        accountLogin: "alice",
        credentialHint: TOKEN.substring(TOKEN.length - 4),
        isTokenRefused: false,
        isReachableFromServer: true,
        repositoryCount: 2,
      },
    ]);
    expect(json(listed)).not.toContain(TOKEN);
    // The token is not even read to list them.
    const reads: Array<Array<unknown>> = (
      CodeRepositoryConnectionService.findBy as unknown as jest.Mock
    ).mock.calls;
    expect(
      (reads[reads.length - 1]![0] as { select: Record<string, unknown> })
        .select,
    ).not.toHaveProperty("credentials");
    expect(
      await CodeRepositoryConnector.listConnections(OTHER_PROJECT_ID),
    ).toEqual([]);
  });
});
