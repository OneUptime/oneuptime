import CodeTaskAccess from "../../../../../Server/Utils/AI/CodeTask/CodeTaskAccess";
import CodeTaskRepositoryList, {
  CODE_REPOSITORY_LIST_SELECT,
  CodeRepositoryListEntry,
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
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
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
 * CODE'S REPOSITORIES AS A LIST SHOWS THEM, HOWEVER MANY (#10764).
 *
 * Code read the first 500 repositories by name and searched, grouped,
 * ordered and paged them in the browser. The server does it now, over
 * every repository the reader may read: searched by name, organization/name
 * or description; split into the repositories AI can work in and those it
 * cannot; by name or by activity; a page at a time, read whole by its ids.
 * Here on a project of 1,200 repositories - the reads stood in for.
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
  organizationName?: string;
  repositoryName?: string;
  description?: string;
  hostedAt?: CodeRepositoryType;
}): CodeRepository {
  const value: CodeRepository = new CodeRepository();
  value._id = ObjectID.generate().toString();
  value.name = data.name;
  value.organizationName = data.organizationName || "acme";
  value.repositoryName = data.repositoryName || data.name;
  value.repositoryHostedAt = data.hostedAt || CodeRepositoryType.GitHub;

  if (data.description) {
    value.description = data.description;
  }

  return value;
}

function summary(
  provider: CodeRepositoryType,
  state: CodeHostConnectionState,
): CodeHostConnectionSummary {
  return {
    connectionId: null,
    provider,
    hostUrl: null,
    hostProduct: null,
    accountLogin: null,
    credentialHint: null,
    state,
    isReachableFromServer: true,
  };
}

function entry(
  name: string,
  isConnected: boolean,
  provider: CodeRepositoryType = CodeRepositoryType.GitHub,
): CodeRepositoryListEntry {
  return { repository: repository({ name }), isConnected, provider };
}

function namesOf(entries: Array<CodeRepositoryListEntry>): Array<string> {
  return entries.map((item: CodeRepositoryListEntry): string => {
    return item.repository.name || "";
  });
}

describe("the rules a list is built by", () => {
  test("each repository is placed by how it connects - connected only when OneUptime reaches it - and read by its host", () => {
    const github: CodeRepository = repository({ name: "web" });
    const gitlab: CodeRepository = repository({
      name: "billing",
      hostedAt: CodeRepositoryType.GitLab,
    });
    const refused: CodeRepository = repository({
      name: "legacy",
      hostedAt: CodeRepositoryType.GitLab,
    });
    const unsummarized: CodeRepository = repository({ name: "orphan" });
    const withoutId: CodeRepository = repository({ name: "nameless" });
    withoutId._id = undefined;

    const entries: Array<CodeRepositoryListEntry> =
      CodeTaskRepositoryList.toEntries({
        repositories: [github, gitlab, refused, unsummarized, withoutId],
        summaries: new Map<string, CodeHostConnectionSummary>([
          [
            github.id!.toString(),
            summary(
              CodeRepositoryType.GitHub,
              CodeHostConnectionState.Connected,
            ),
          ],
          [
            gitlab.id!.toString(),
            summary(
              CodeRepositoryType.GitLab,
              CodeHostConnectionState.Connected,
            ),
          ],
          [
            refused.id!.toString(),
            summary(
              CodeRepositoryType.GitLab,
              CodeHostConnectionState.TokenRefused,
            ),
          ],
        ]),
      });

    expect(
      entries.map((item: CodeRepositoryListEntry) => {
        return [item.repository.name, item.isConnected, item.provider];
      }),
    ).toEqual([
      ["web", true, CodeRepositoryType.GitHub],
      ["billing", true, CodeRepositoryType.GitLab],
      // A refused token is not a repository AI can work in.
      ["legacy", false, CodeRepositoryType.GitLab],
      ["orphan", false, CodeRepositoryType.GitHub],
    ]);
  });

  test("a list asked for holds only its own; both lists hold all", () => {
    const connected: CodeRepositoryListEntry = entry("web", true);
    const notConnected: CodeRepositoryListEntry = entry("legacy", false);

    expect(
      CodeTaskRepositoryList.isInGroup(
        connected,
        CodeRepositoryListGroup.Connected,
      ),
    ).toBe(true);
    expect(
      CodeTaskRepositoryList.isInGroup(
        notConnected,
        CodeRepositoryListGroup.Connected,
      ),
    ).toBe(false);
    expect(
      CodeTaskRepositoryList.isInGroup(
        notConnected,
        CodeRepositoryListGroup.NotConnected,
      ),
    ).toBe(true);
    expect(
      CodeTaskRepositoryList.isInGroup(
        connected,
        CodeRepositoryListGroup.NotConnected,
      ),
    ).toBe(false);
    expect(CodeTaskRepositoryList.isInGroup(connected, null)).toBe(true);
    expect(CodeTaskRepositoryList.isInGroup(notConnected, null)).toBe(true);
  });

  test("by name: the order they came in (the database's), those AI can work in first when both lists are asked for", () => {
    const entries: Array<CodeRepositoryListEntry> = [
      entry("alpha", false),
      entry("beta", true),
      entry("gamma", false),
      entry("delta", true),
    ];

    expect(
      namesOf(
        CodeTaskRepositoryList.order({
          entries,
          order: CodeRepositoryListOrder.Name,
          lastActivity: new Map(),
          connectedFirst: false,
        }),
      ),
    ).toEqual(["alpha", "beta", "gamma", "delta"]);
    expect(
      namesOf(
        CodeTaskRepositoryList.order({
          entries,
          order: CodeRepositoryListOrder.Name,
          lastActivity: new Map(),
          connectedFirst: true,
        }),
      ),
    ).toEqual(["beta", "delta", "alpha", "gamma"]);
  });

  test("by activity: the most recent first, those nothing happened in last, ties kept by name", () => {
    const entries: Array<CodeRepositoryListEntry> = [
      entry("alpha", true),
      entry("beta", true),
      entry("gamma", true),
      entry("delta", false),
      entry("epsilon", true),
    ];
    const at: (minutes: number) => Date = (minutes: number): Date => {
      return new Date(Date.UTC(2026, 10, 24, 12, minutes));
    };
    const lastActivity: Map<string, Date> = new Map<string, Date>([
      [entries[1]!.repository.id!.toString().toLowerCase(), at(5)],
      [entries[2]!.repository.id!.toString().toLowerCase(), at(30)],
      [entries[3]!.repository.id!.toString().toLowerCase(), at(50)],
      [entries[4]!.repository.id!.toString().toLowerCase(), at(5)],
    ]);

    expect(
      namesOf(
        CodeTaskRepositoryList.order({
          entries,
          order: CodeRepositoryListOrder.Activity,
          lastActivity,
          connectedFirst: false,
        }),
      ),
    ).toEqual(["delta", "gamma", "beta", "epsilon", "alpha"]);

    // Both lists at once: those AI can work in first, each by activity.
    expect(
      namesOf(
        CodeTaskRepositoryList.order({
          entries,
          order: CodeRepositoryListOrder.Activity,
          lastActivity,
          connectedFirst: true,
        }),
      ),
    ).toEqual(["gamma", "beta", "epsilon", "alpha", "delta"]);
  });

  test("what is true of all of them: how many each list holds, and where they are hosted", () => {
    expect(
      CodeTaskRepositoryList.getFacts([
        entry("web", true),
        entry("legacy", false),
        entry("billing", true, CodeRepositoryType.GitLab),
      ]),
    ).toEqual({
      total: 3,
      connected: 2,
      notConnected: 1,
      areAllOnGitHub: false,
      isAnyOnGitHub: true,
      areAllNotConnectedOnGitHub: true,
      isAnyNotConnectedOnGitHub: true,
    });

    expect(
      CodeTaskRepositoryList.getFacts([
        entry("forge", false, CodeRepositoryType.Git),
      ]),
    ).toEqual({
      total: 1,
      connected: 0,
      notConnected: 1,
      areAllOnGitHub: false,
      isAnyOnGitHub: false,
      areAllNotConnectedOnGitHub: false,
      isAnyNotConnectedOnGitHub: false,
    });

    expect(CodeTaskRepositoryList.getFacts([])).toMatchObject({
      total: 0,
      connected: 0,
      notConnected: 0,
    });
  });

  test("how many of each list a search found", () => {
    expect(
      CodeTaskRepositoryList.getMatches([
        entry("web", true),
        entry("legacy", false),
        entry("api", true),
      ]),
    ).toEqual({ connected: 2, notConnected: 1 });
    expect(CodeTaskRepositoryList.getMatches([])).toEqual({
      connected: 0,
      notConnected: 0,
    });
  });
});

describe("a page of the reader's repositories, on a project of 1,200", () => {
  let all: Array<CodeRepository>;
  let late: CodeRepository;
  let byDescription: CodeRepository;

  // The page's rows, read whole by their ids - in the database's order, not the page's.
  let pageReads: Array<Array<string>>;

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

    for (let index: number = 1; index <= 1200; index++) {
      all.push(
        repository({ name: `ap-${String(index).padStart(6, "0")}-service` }),
      );
    }

    // Past the 500th by name: what the first page never had.
    late = all[1149]!;
    late.name = "zebra-checkout";
    late.organizationName = "harbour";
    late.repositoryName = "zebra";
    byDescription = all[800]!;
    byDescription.description = "Handles the warehouse stock counts.";
    pageReads = [];

    jest
      .spyOn(CodeTaskAccess, "listReadableRepositories")
      .mockImplementation(async () => {
        return all;
      });
    // Every other repository is connected through the GitHub App.
    jest
      .spyOn(CodeHostAccess, "getConnectionSummaries")
      .mockImplementation(async (data: { repositoryIds: Array<ObjectID> }) => {
        const summaries: Map<string, CodeHostConnectionSummary> = new Map();

        data.repositoryIds.forEach((id: ObjectID, index: number) => {
          summaries.set(
            id.toString(),
            summary(
              CodeRepositoryType.GitHub,
              index % 2 === 0
                ? CodeHostConnectionState.Connected
                : CodeHostConnectionState.GitHubNotConnected,
            ),
          );
        });

        return summaries;
      });
    jest
      .spyOn(CodeTaskAccess, "listReadableRepositoriesByIds")
      .mockImplementation(
        async (data: { repositoryIds: Array<ObjectID | string> }) => {
          const ids: Array<string> = data.repositoryIds.map(
            (id: ObjectID | string): string => {
              return id.toString();
            },
          );

          pageReads.push(ids);

          return [...ids].reverse().map((id: string): CodeRepository => {
            return all.find((row: CodeRepository): boolean => {
              return row.id!.toString() === id;
            })!;
          });
        },
      );
    jest.spyOn(CodeTaskStats, "getLastActivity").mockResolvedValue(new Map());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("every repository the reader may read is weighed, read as the reader with only what a list needs", async () => {
    const page: CodeRepositoryListPage = await read({});

    expect(CodeTaskAccess.listReadableRepositories).toHaveBeenCalledWith({
      props: READER,
      projectId: PROJECT_ID,
      select: CODE_REPOSITORY_LIST_SELECT,
    });
    expect(page.facts).toEqual({
      total: 1200,
      connected: 600,
      notConnected: 600,
      areAllOnGitHub: true,
      isAnyOnGitHub: true,
      areAllNotConnectedOnGitHub: true,
      isAnyNotConnectedOnGitHub: true,
    });
    expect(page.count).toBe(1200);
    expect(page.matches).toEqual({ connected: 600, notConnected: 600 });
  });

  test("a search finds a repository past the 500th by its name, its organization/name or its description", async () => {
    for (const search of ["zebra", "HARBOUR/ze", "harbour/zebra"]) {
      const page: CodeRepositoryListPage = await read({ search });

      expect(
        page.repositories.map((row: CodeRepository): string => {
          return row.name || "";
        }),
      ).toEqual(["zebra-checkout"]);
      expect(page.count).toBe(1);
    }

    const described: CodeRepositoryListPage = await read({
      search: "warehouse stock",
    });

    expect(described.repositories).toEqual([byDescription]);
  });

  test("what a search finds of each list, and what is true of all of them whatever it finds", async () => {
    const page: CodeRepositoryListPage = await read({ search: "zebra" });

    // The 1,150th: an index of 1,149, so not connected (every other one is).
    expect(page.matches).toEqual({ connected: 0, notConnected: 1 });
    expect(page.facts.total).toBe(1200);
  });

  test("one list asked for: its own only, counted alone", async () => {
    const connected: CodeRepositoryListPage = await read({
      group: CodeRepositoryListGroup.Connected,
      search: "zebra",
    });

    expect(connected.repositories).toEqual([]);
    expect(connected.count).toBe(0);
    expect(connected.matches).toEqual({ connected: 0, notConnected: 1 });

    const notConnected: CodeRepositoryListPage = await read({
      group: CodeRepositoryListGroup.NotConnected,
      search: "zebra",
    });

    expect(notConnected.repositories).toEqual([late]);
    expect(notConnected.count).toBe(1);
  });

  test("a page past the 500th, in the list's order, read whole by its ids as the reader", async () => {
    const page: CodeRepositoryListPage = await read({
      group: CodeRepositoryListGroup.Connected,
      skip: 500,
      limit: 3,
    });

    // The 501st to 503rd connected ones: every other repository from the 1,001st.
    expect(
      page.repositories.map((row: CodeRepository): string => {
        return row.name || "";
      }),
    ).toEqual([
      "ap-001001-service",
      "ap-001003-service",
      "ap-001005-service",
    ]);
    expect(page.count).toBe(600);
    expect(pageReads).toEqual([
      page.repositories.map((row: CodeRepository): string => {
        return row.id!.toString();
      }),
    ]);
    expect(CodeTaskAccess.listReadableRepositoriesByIds).toHaveBeenCalledWith(
      expect.objectContaining({ props: READER, projectId: PROJECT_ID }),
    );
    // How each repository on the page connects, by its id.
    expect(Array.from(page.connections.keys())).toEqual(
      page.repositories.map((row: CodeRepository): string => {
        return row.id!.toString();
      }),
    );
  });

  test("a page past the end reads nothing whole", async () => {
    const page: CodeRepositoryListPage = await read({ skip: 5000 });

    expect(page.repositories).toEqual([]);
    expect(page.count).toBe(1200);
    expect(CodeTaskAccess.listReadableRepositoriesByIds).not.toHaveBeenCalled();
  });

  test("by activity, every repository of the list asked for is ordered - not one page of them - for the reader", async () => {
    const lastActivity: Map<string, Date> = new Map<string, Date>([
      [late.id!.toString().toLowerCase(), new Date("2026-11-24T10:00:00Z")],
    ]);

    jest
      .spyOn(CodeTaskStats, "getLastActivity")
      .mockResolvedValue(lastActivity);

    const page: CodeRepositoryListPage = await read({
      group: CodeRepositoryListGroup.NotConnected,
      order: CodeRepositoryListOrder.Activity,
      limit: 2,
    });

    expect(
      page.repositories.map((row: CodeRepository): string => {
        return row.name || "";
      }),
    ).toEqual(["zebra-checkout", "ap-000002-service"]);

    const asked: { repositoryIds: Array<ObjectID>; reader: unknown } = (
      CodeTaskStats.getLastActivity as unknown as {
        mock: { calls: Array<Array<unknown>> };
      }
    ).mock.calls[0]![0] as { repositoryIds: Array<ObjectID>; reader: unknown };

    expect(asked.repositoryIds).toHaveLength(600);
    expect(asked.reader).toBe(READER);
  });

  test("by name, no activity is read at all", async () => {
    await read({ order: CodeRepositoryListOrder.Name });

    expect(CodeTaskStats.getLastActivity).not.toHaveBeenCalled();
  });

  test("both lists asked for: those AI can work in first, then those it cannot", async () => {
    const page: CodeRepositoryListPage = await read({
      skip: 598,
      limit: 4,
    });

    expect(
      page.repositories.map((row: CodeRepository): string => {
        return row.name || "";
      }),
    ).toEqual([
      "ap-001197-service",
      "ap-001199-service",
      "ap-000002-service",
      "ap-000004-service",
    ]);
  });

  test("a repository the reader stopped being able to read between the two reads is left out of the page", async () => {
    jest
      .spyOn(CodeTaskAccess, "listReadableRepositoriesByIds")
      .mockResolvedValue([all[0]!]);

    const page: CodeRepositoryListPage = await read({ limit: 3 });

    expect(page.repositories).toEqual([all[0]!]);
  });
});
