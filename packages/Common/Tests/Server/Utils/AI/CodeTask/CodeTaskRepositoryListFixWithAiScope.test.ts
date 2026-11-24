import CodeTaskAccess from "../../../../../Server/Utils/AI/CodeTask/CodeTaskAccess";
import CodeTaskRepositoryList, {
  CODE_REPOSITORY_LIST_SELECT,
  CodeRepositoryListPage,
  CodeRepositoryListRequest,
} from "../../../../../Server/Utils/AI/CodeTask/CodeTaskRepositoryList";
import CodeTaskStats from "../../../../../Server/Utils/AI/CodeTask/CodeTaskStats";
import CodeHostAccess, {
  CodeHostConnectionState,
  CodeHostConnectionSummary,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostAccess";
import CodeRepository from "../../../../../Models/DatabaseModels/CodeRepository";
import {
  CodeRepositoryListGroup,
  CodeRepositoryListOrder,
} from "../../../../../Types/AI/CodeTask";
import URL from "../../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { isCodeReadableRepository } from "../../../../../Types/CodeRepository/CodeReadableRepository";
import CodeRepositoryType from "../../../../../Types/CodeRepository/CodeRepositoryType";
import ObjectID from "../../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE REPOSITORIES A FIX WITH AI PICKER OFFERS, HELD TO WHAT ITS FIX
 * ACCEPTS (#10921).
 *
 * Every Fix with AI repository choice was a fixed list of every repository
 * the person may ask in - one very long list in a project of thousands. The
 * pickers search Code's list of repositories on the server now, and that
 * list is held, before anything else is weighed, to exactly what the fix
 * then accepts: the repositories the reader may ask OneUptime AI to work in
 * (askableOnly - one read a batch for all of them, never one a repository)
 * and, for a finding's or a profile's fix, those whose code OneUptime reads
 * (codeReadableOnly, the rule SourceLocator keeps them by). The search, the
 * lists, the order, the page, the count, the facts and the matches then
 * describe only those. Here on a project of 1,200 repositories, the reads
 * stood in for.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "2b7c4e1a-9d3f-4a6b-8c5d-1e2f3a4b5c6d",
);
const READER: DatabaseCommonInteractionProps = {
  userId: new ObjectID("7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"),
  tenantId: PROJECT_ID,
} as DatabaseCommonInteractionProps;

function repository(data: {
  name: string;
  organizationName?: string | null;
  repositoryName?: string | null;
  hostedAt?: CodeRepositoryType;
  repositoryUrl?: string;
}): CodeRepository {
  const value: CodeRepository = new CodeRepository();
  value._id = ObjectID.generate().toString();
  value.name = data.name;

  if (data.organizationName !== null) {
    value.organizationName = data.organizationName || "acme";
  }

  if (data.repositoryName !== null) {
    value.repositoryName = data.repositoryName || data.name;
  }

  value.repositoryHostedAt = data.hostedAt || CodeRepositoryType.GitHub;

  if (data.repositoryUrl) {
    value.repositoryUrl = URL.fromString(data.repositoryUrl);
  }

  return value;
}

function summary(data: {
  provider?: CodeRepositoryType;
  state?: CodeHostConnectionState;
  isReachableFromServer?: boolean;
}): CodeHostConnectionSummary {
  return {
    connectionId: null,
    provider: data.provider || CodeRepositoryType.GitHub,
    hostUrl: null,
    hostProduct: null,
    accountLogin: null,
    credentialHint: null,
    state: data.state || CodeHostConnectionState.Connected,
    isReachableFromServer: data.isReachableFromServer !== false,
  };
}

function idOf(row: CodeRepository): string {
  return row.id!.toString();
}

function namesOf(rows: Array<CodeRepository>): Array<string> {
  return rows.map((row: CodeRepository): string => {
    return row.name || "";
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("which repositories OneUptime reads the code of: one rule", () => {
  test("connected, reachable from the server, owner and name known, on a host whose code OneUptime reads", () => {
    expect(
      isCodeReadableRepository({
        organizationName: "acme",
        repositoryName: "web",
        provider: CodeRepositoryType.GitHub,
        isConnected: true,
        isReachableFromServer: true,
      }),
    ).toBe(true);

    for (const provider of [
      CodeRepositoryType.GitLab,
      CodeRepositoryType.Forgejo,
    ]) {
      expect(
        isCodeReadableRepository({
          organizationName: "acme",
          repositoryName: "web",
          provider,
          isConnected: true,
          isReachableFromServer: true,
        }),
      ).toBe(true);
    }
  });

  test.each([
    ["not connected", { isConnected: false }],
    ["its Git server out of the server's reach", { isReachableFromServer: false }],
    ["no owner", { organizationName: "" }],
    ["no name on its host", { repositoryName: null }],
  ])(
    "a repository %s is not read",
    (_name: string, facts: Record<string, unknown>) => {
      expect(
        isCodeReadableRepository({
          organizationName: "acme",
          repositoryName: "web",
          provider: CodeRepositoryType.GitHub,
          isConnected: true,
          isReachableFromServer: true,
          ...facts,
        }),
      ).toBe(false);
    },
  );

  test("a Git repository is read on Azure DevOps alone, by the address it is cloned by", () => {
    const facts: {
      organizationName: string;
      repositoryName: string;
      provider: CodeRepositoryType;
      isConnected: boolean;
      isReachableFromServer: boolean;
    } = {
      organizationName: "acme",
      repositoryName: "app",
      provider: CodeRepositoryType.Git,
      isConnected: true,
      isReachableFromServer: true,
    };

    expect(
      isCodeReadableRepository({
        ...facts,
        repositoryUrl: "https://dev.azure.com/acme/Shop/_git/app",
      }),
    ).toBe(true);
    // The model's URL type, read as text.
    expect(
      isCodeReadableRepository({
        ...facts,
        repositoryUrl: URL.fromString(
          "https://acme.visualstudio.com/Shop/_git/app",
        ),
      }),
    ).toBe(true);
    expect(
      isCodeReadableRepository({
        ...facts,
        repositoryUrl: "https://git.example.com/team/app.git",
      }),
    ).toBe(false);
    expect(isCodeReadableRepository({ ...facts })).toBe(false);
  });

  test("judged from a repository and how it connects; one with no connection summary is not connected", () => {
    const web: CodeRepository = repository({ name: "web" });

    expect(CodeTaskRepositoryList.isCodeReadable(web, summary({}))).toBe(true);
    expect(CodeTaskRepositoryList.isCodeReadable(web, undefined)).toBe(false);
    expect(
      CodeTaskRepositoryList.isCodeReadable(
        web,
        summary({ state: CodeHostConnectionState.GitHubNotConnected }),
      ),
    ).toBe(false);
    expect(
      CodeTaskRepositoryList.isCodeReadable(
        web,
        summary({
          provider: CodeRepositoryType.GitLab,
          state: CodeHostConnectionState.TokenRefused,
        }),
      ),
    ).toBe(false);
    expect(
      CodeTaskRepositoryList.isCodeReadable(
        web,
        summary({
          provider: CodeRepositoryType.GitLab,
          state: CodeHostConnectionState.NoConnection,
        }),
      ),
    ).toBe(false);
  });

  test("the list reads the address a Git repository is cloned by, with what else it reads of every repository", () => {
    expect(CODE_REPOSITORY_LIST_SELECT).toMatchObject({
      _id: true,
      name: true,
      organizationName: true,
      repositoryName: true,
      repositoryHostedAt: true,
      repositoryUrl: true,
    });
  });
});

describe("holding repositories to what a picker may offer", () => {
  let askableCalls: Array<Array<string>>;
  let askable: Set<string>;

  beforeEach(() => {
    askableCalls = [];
    askable = new Set<string>();

    jest
      .spyOn(CodeTaskAccess, "listAskableRepositoryIds")
      .mockImplementation(
        async (data: { repositoryIds: Array<ObjectID | string> }) => {
          const ids: Array<string> = data.repositoryIds.map(
            (id: ObjectID | string): string => {
              return id.toString();
            },
          );

          askableCalls.push(ids);

          return new Set<string>(
            ids
              .map((id: string): string => {
                return id.toLowerCase();
              })
              .filter((id: string): boolean => {
                return askable.has(id);
              }),
          );
        },
      );
  });

  test("held to neither: every repository, in its order, and nothing is asked", async () => {
    const rows: Array<CodeRepository> = [
      repository({ name: "web" }),
      repository({ name: "api" }),
    ];

    const held: Array<CodeRepository> = await CodeTaskRepositoryList.keepHeldTo(
      {
        props: READER,
        projectId: PROJECT_ID,
        repositories: rows,
        summaries: new Map(),
        scope: {},
      },
    );

    expect(held).toEqual(rows);
    expect(askableCalls).toEqual([]);
  });

  test("askable only: one read for all of them - past the 500th too - as the reader, in the project", async () => {
    const rows: Array<CodeRepository> = Array.from(
      { length: 1200 },
      (_: unknown, index: number): CodeRepository => {
        return repository({ name: `ap-${String(index).padStart(6, "0")}` });
      },
    );

    // The reader may ask in every third one, the last among them.
    rows.forEach((row: CodeRepository, index: number) => {
      if (index % 3 === 0) {
        askable.add(idOf(row).toLowerCase());
      }
    });

    const held: Array<CodeRepository> = await CodeTaskRepositoryList.keepHeldTo(
      {
        props: READER,
        projectId: PROJECT_ID,
        repositories: rows,
        summaries: new Map(),
        scope: { askableOnly: true },
      },
    );

    expect(held).toHaveLength(400);
    expect(held[399]).toBe(rows[1197]);
    expect(askableCalls).toHaveLength(1);
    expect(askableCalls[0]).toHaveLength(1200);
    expect(CodeTaskAccess.listAskableRepositoryIds).toHaveBeenCalledWith(
      expect.objectContaining({ props: READER, projectId: PROJECT_ID }),
    );
  });

  test("askable only, for a reader who may read every repository but ask in none: none", async () => {
    const held: Array<CodeRepository> = await CodeTaskRepositoryList.keepHeldTo(
      {
        props: READER,
        projectId: PROJECT_ID,
        repositories: [repository({ name: "web" }), repository({ name: "api" })],
        summaries: new Map(),
        scope: { askableOnly: true },
      },
    );

    expect(held).toEqual([]);
  });

  test("an id is matched whatever its letter case", async () => {
    const row: CodeRepository = repository({ name: "web" });
    row._id = row._id!.toString().toUpperCase();
    askable.add(row._id.toLowerCase());

    const held: Array<CodeRepository> = await CodeTaskRepositoryList.keepHeldTo(
      {
        props: READER,
        projectId: PROJECT_ID,
        repositories: [row],
        summaries: new Map(),
        scope: { askableOnly: true },
      },
    );

    expect(held).toEqual([row]);
  });

  test("code readable only: judged from how each connects, and asks nothing of the database", async () => {
    const read: CodeRepository = repository({ name: "read" });
    const unreachable: CodeRepository = repository({
      name: "on-a-private-network",
      hostedAt: CodeRepositoryType.GitLab,
    });
    const refused: CodeRepository = repository({
      name: "refused",
      hostedAt: CodeRepositoryType.GitLab,
    });
    const plainGit: CodeRepository = repository({
      name: "plain-git",
      hostedAt: CodeRepositoryType.Git,
      repositoryUrl: "https://git.example.com/team/plain-git.git",
    });
    const azure: CodeRepository = repository({
      name: "azure",
      hostedAt: CodeRepositoryType.Git,
      repositoryUrl: "https://dev.azure.com/acme/Shop/_git/azure",
    });
    const nameless: CodeRepository = repository({
      name: "nameless",
      repositoryName: null,
    });
    const unsummarized: CodeRepository = repository({ name: "orphan" });

    const summaries: Map<string, CodeHostConnectionSummary> = new Map([
      [idOf(read), summary({})],
      [
        idOf(unreachable),
        summary({
          provider: CodeRepositoryType.GitLab,
          isReachableFromServer: false,
        }),
      ],
      [
        idOf(refused),
        summary({
          provider: CodeRepositoryType.GitLab,
          state: CodeHostConnectionState.TokenRefused,
        }),
      ],
      [idOf(plainGit), summary({ provider: CodeRepositoryType.Git })],
      [idOf(azure), summary({ provider: CodeRepositoryType.Git })],
      [idOf(nameless), summary({})],
    ]);

    const held: Array<CodeRepository> = await CodeTaskRepositoryList.keepHeldTo(
      {
        props: READER,
        projectId: PROJECT_ID,
        repositories: [
          read,
          unreachable,
          refused,
          plainGit,
          azure,
          nameless,
          unsummarized,
        ],
        summaries,
        scope: { codeReadableOnly: true },
      },
    );

    expect(namesOf(held)).toEqual(["read", "azure"]);
    expect(askableCalls).toEqual([]);
  });

  test("both: whether the reader may ask is asked only of the ones whose code OneUptime reads", async () => {
    const read: CodeRepository = repository({ name: "read" });
    const readNotAskable: CodeRepository = repository({ name: "read-only" });
    const notRead: CodeRepository = repository({ name: "not-connected" });

    askable.add(idOf(read).toLowerCase());
    askable.add(idOf(notRead).toLowerCase());

    const held: Array<CodeRepository> = await CodeTaskRepositoryList.keepHeldTo(
      {
        props: READER,
        projectId: PROJECT_ID,
        repositories: [read, readNotAskable, notRead],
        summaries: new Map([
          [idOf(read), summary({})],
          [idOf(readNotAskable), summary({})],
          [
            idOf(notRead),
            summary({ state: CodeHostConnectionState.GitHubNotConnected }),
          ],
        ]),
        scope: { askableOnly: true, codeReadableOnly: true },
      },
    );

    expect(namesOf(held)).toEqual(["read"]);
    expect(askableCalls).toEqual([[idOf(read), idOf(readNotAskable)]]);
  });

  test("nothing left to ask about: nothing is asked", async () => {
    const held: Array<CodeRepository> = await CodeTaskRepositoryList.keepHeldTo(
      {
        props: READER,
        projectId: PROJECT_ID,
        repositories: [repository({ name: "web" })],
        summaries: new Map(),
        scope: { askableOnly: true, codeReadableOnly: true },
      },
    );

    expect(held).toEqual([]);
    expect(askableCalls).toEqual([]);
  });
});

describe("a page of the repositories a picker may offer, on a project of 1,200", () => {
  let all: Array<CodeRepository>;
  let late: CodeRepository;
  let lateNotAskable: CodeRepository;
  let askable: Set<string>;
  let askableCalls: number;

  function request(
    data: Partial<CodeRepositoryListRequest>,
  ): CodeRepositoryListRequest {
    return {
      search: "",
      group: null,
      order: CodeRepositoryListOrder.Name,
      skip: 0,
      limit: 50,
      ...data,
    };
  }

  async function read(
    data: Partial<CodeRepositoryListRequest>,
  ): Promise<CodeRepositoryListPage> {
    return await CodeTaskRepositoryList.read({
      props: READER,
      projectId: PROJECT_ID,
      request: request(data),
    });
  }

  beforeEach(() => {
    all = [];
    askable = new Set<string>();
    askableCalls = 0;

    for (let index: number = 1; index <= 1200; index++) {
      all.push(
        repository({ name: `ap-${String(index).padStart(6, "0")}-service` }),
      );
    }

    // Past the 500th by name: what a first page never had.
    late = all[1150]!;
    late.name = "zebra-checkout";
    lateNotAskable = all[1151]!;
    lateNotAskable.name = "zebra-ledger";

    // The reader may ask in every even one (index), the late one too.
    all.forEach((row: CodeRepository, index: number) => {
      if (index % 2 === 0) {
        askable.add(idOf(row).toLowerCase());
      }
    });

    jest
      .spyOn(CodeTaskAccess, "listReadableRepositories")
      .mockImplementation(async () => {
        return all;
      });
    // Every repository is connected, but every fourth is on a private network.
    jest
      .spyOn(CodeHostAccess, "getConnectionSummaries")
      .mockImplementation(async (data: { repositoryIds: Array<ObjectID> }) => {
        const summaries: Map<string, CodeHostConnectionSummary> = new Map();

        data.repositoryIds.forEach((id: ObjectID, index: number) => {
          summaries.set(
            id.toString(),
            summary({ isReachableFromServer: index % 4 !== 2 }),
          );
        });

        return summaries;
      });
    jest
      .spyOn(CodeTaskAccess, "listAskableRepositoryIds")
      .mockImplementation(
        async (data: { repositoryIds: Array<ObjectID | string> }) => {
          askableCalls++;

          return new Set<string>(
            data.repositoryIds
              .map((id: ObjectID | string): string => {
                return id.toString().toLowerCase();
              })
              .filter((id: string): boolean => {
                return askable.has(id);
              }),
          );
        },
      );
    jest
      .spyOn(CodeTaskAccess, "listReadableRepositoriesByIds")
      .mockImplementation(
        async (data: { repositoryIds: Array<ObjectID | string> }) => {
          return data.repositoryIds.map((id: ObjectID | string) => {
            return all.find((row: CodeRepository): boolean => {
              return idOf(row) === id.toString();
            })!;
          });
        },
      );
    jest.spyOn(CodeTaskStats, "getLastActivity").mockResolvedValue(new Map());
  });

  test("a read held to nothing reads as it always did, and asks nothing of who may ask", async () => {
    const page: CodeRepositoryListPage = await read({});

    expect(page.count).toBe(1200);
    expect(page.facts.total).toBe(1200);
    expect(askableCalls).toBe(0);
  });

  test("askable only: a search finds one past the 500th the reader may ask in, and never one they may not", async () => {
    const found: CodeRepositoryListPage = await read({
      search: "zebra",
      askableOnly: true,
    });

    expect(namesOf(found.repositories)).toEqual(["zebra-checkout"]);
    expect(found.count).toBe(1);
    expect(askableCalls).toBe(1);

    // The same search, held to nothing, finds both.
    const both: CodeRepositoryListPage = await read({ search: "zebra" });

    expect(namesOf(both.repositories)).toEqual([
      "zebra-checkout",
      "zebra-ledger",
    ]);
  });

  test("askable only: the count, the facts and the matches describe only what the picker may offer", async () => {
    const page: CodeRepositoryListPage = await read({ askableOnly: true });

    expect(page.count).toBe(600);
    expect(page.facts.total).toBe(600);
    expect(page.facts.connected).toBe(600);
    expect(page.matches).toEqual({ connected: 600, notConnected: 0 });
  });

  test("askable only: a page past the 500th of them, in name order, read whole by its ids", async () => {
    const page: CodeRepositoryListPage = await read({
      askableOnly: true,
      group: CodeRepositoryListGroup.Connected,
      skip: 500,
      limit: 3,
    });

    // Every even index, from the 1,001st repository on (index 1,000).
    expect(namesOf(page.repositories)).toEqual([
      "ap-001001-service",
      "ap-001003-service",
      "ap-001005-service",
    ]);
    expect(page.count).toBe(600);
  });

  test("askable and code readable: those on a private network are left out of the search, the page and the count", async () => {
    const page: CodeRepositoryListPage = await read({
      askableOnly: true,
      codeReadableOnly: true,
    });

    // Even indexes, less every fourth's private network (index % 4 === 2).
    expect(page.count).toBe(300);
    expect(page.facts.total).toBe(300);

    for (const row of page.repositories) {
      const index: number = all.indexOf(row);

      expect(index % 2).toBe(0);
      expect(index % 4).not.toBe(2);
    }
  });

  test("code readable only, without asking who may ask", async () => {
    const page: CodeRepositoryListPage = await read({ codeReadableOnly: true });

    expect(page.count).toBe(900);
    expect(askableCalls).toBe(0);
  });

  test("a reader who may ask in none sees none, and is told how many there are: none", async () => {
    askable.clear();

    const page: CodeRepositoryListPage = await read({
      askableOnly: true,
      search: "zebra",
    });

    expect(page.repositories).toEqual([]);
    expect(page.count).toBe(0);
    expect(page.facts.total).toBe(0);
    expect(CodeTaskAccess.listReadableRepositoriesByIds).not.toHaveBeenCalled();
  });
});
