import CodeRepositoryService from "../../../../Server/Services/CodeRepositoryService";
import CodeTaskAccess from "../../../../Server/Utils/AI/CodeTask/CodeTaskAccess";
import CodeHostAccess, {
  CodeHostConnectionState,
  CodeHostConnectionSummary,
} from "../../../../Server/Utils/CodeRepository/CodeHost/CodeHostAccess";
import SourceLocator, {
  LOCATABLE_READ_PAGE_SIZE,
  LocatableRepositoryWithTree,
  MAX_REPOSITORIES_PROBED,
} from "../../../../Server/Utils/CodeRepository/SourceLocator";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import CodeRepositoryType from "../../../../Types/CodeRepository/CodeRepositoryType";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * THE REPOSITORIES WHOSE FILES ONEUPTIME READS FOR A PERSON - EVERY ONE OF
 * THEM (#10764).
 *
 * getLocatableRepositories read the first 500 repositories the person may
 * read, by name, and kept those OneUptime reaches: a repository past them
 * was never offered by a finding's Fix with AI, a profile fix asked in one
 * was refused as "not available", and a project whose reachable
 * repositories were all past them got no source link at all. It pages
 * through every one of the person's repositories now - by name - and stops
 * early only when told how many it needs: a frame lookup probes ten trees,
 * a readiness check needs one.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "2b7c4e1a-9d3f-4a6b-8c5d-1e2f3a4b5c6d",
);
const READER: DatabaseCommonInteractionProps = {
  userId: new ObjectID("7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"),
  tenantId: PROJECT_ID,
} as DatabaseCommonInteractionProps;
const INSTALLATION_ID: string = "4242";

let all: Array<CodeRepository>;
// The repositories OneUptime reaches, by id.
let reached: Set<string>;
let pagesRead: Array<{ skip: number; limit: number; props: unknown }>;

function makeRepositories(count: number): Array<CodeRepository> {
  const rows: Array<CodeRepository> = [];

  for (let index: number = 1; index <= count; index++) {
    const row: CodeRepository = new CodeRepository();
    row._id = ObjectID.generate().toString();
    row.name = `repository-${String(index).padStart(5, "0")}`;
    row.organizationName = "acme";
    row.repositoryName = row.name;
    row.mainBranchName = "main";
    row.repositoryHostedAt = CodeRepositoryType.GitHub;
    row.gitHubAppInstallationId = INSTALLATION_ID;
    rows.push(row);
  }

  return rows;
}

function namesOf(
  repositories: Array<LocatableRepositoryWithTree>,
): Array<string> {
  return repositories.map((repository: LocatableRepositoryWithTree): string => {
    return repository.name;
  });
}

beforeEach(() => {
  all = makeRepositories(1200);
  reached = new Set<string>();
  pagesRead = [];

  jest
    .spyOn(CodeTaskAccess, "readReadableRepositoriesPage")
    .mockImplementation(
      async (data: { skip: number; limit: number; props: unknown }) => {
        pagesRead.push({
          skip: data.skip,
          limit: data.limit,
          props: data.props,
        });

        return all.slice(data.skip, data.skip + data.limit);
      },
    );
  jest
    .spyOn(CodeHostAccess, "getConnectionSummaries")
    .mockImplementation(async (data: { repositoryIds: Array<ObjectID> }) => {
      const summaries: Map<string, CodeHostConnectionSummary> = new Map();

      for (const id of data.repositoryIds) {
        summaries.set(id.toString(), {
          connectionId: null,
          provider: CodeRepositoryType.GitHub,
          hostUrl: null,
          hostProduct: null,
          accountLogin: null,
          credentialHint: null,
          state: reached.has(id.toString())
            ? CodeHostConnectionState.Connected
            : CodeHostConnectionState.GitHubNotConnected,
          isReachableFromServer: true,
        });
      }

      return summaries;
    });
  // The root read of the installation each is reached through - in no particular order.
  jest.spyOn(CodeRepositoryService, "findBy").mockImplementation((async (data: {
    query: { _id: unknown };
    props: { isRoot?: boolean };
  }) => {
    expect(data.props.isRoot).toBe(true);

    // The ids asked for: the Raw operator's one list of values.
    const parameters: Record<string, unknown> =
      (data.query._id as { objectLiteralParameters?: Record<string, unknown> })
        .objectLiteralParameters || {};
    const asked: Set<string> = new Set<string>(
      ((Object.values(parameters)[0] as Array<unknown> | undefined) || []).map(
        (id: unknown): string => {
          return String(id);
        },
      ),
    );

    return all
      .filter((row: CodeRepository): boolean => {
        return asked.size === 0 || asked.has(row.id!.toString());
      })
      .reverse();
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SourceLocator.getLocatableRepositories", () => {
  test("every repository OneUptime reaches is found, however far past the 500th - read a page at a time as the person", async () => {
    // Only three, all past the first 1,000 by name.
    for (const index of [1001, 1100, 1199]) {
      reached.add(all[index]!.id!.toString());
    }

    const locatable: Array<LocatableRepositoryWithTree> =
      await SourceLocator.getLocatableRepositories({
        projectId: PROJECT_ID,
        props: READER,
      });

    expect(namesOf(locatable)).toEqual([
      "repository-01002",
      "repository-01101",
      "repository-01200",
    ]);
    expect(
      pagesRead.map((page: { skip: number; limit: number }) => {
        return [page.skip, page.limit];
      }),
    ).toEqual([
      [0, LOCATABLE_READ_PAGE_SIZE],
      [LOCATABLE_READ_PAGE_SIZE, LOCATABLE_READ_PAGE_SIZE],
      [2 * LOCATABLE_READ_PAGE_SIZE, LOCATABLE_READ_PAGE_SIZE],
    ]);

    for (const page of pagesRead) {
      expect(page.props).toBe(READER);
    }

    // Each with the installation its tree is read through.
    expect(locatable[0]!.gitHubAppInstallationId).toBe(INSTALLATION_ID);
  });

  test("by name, within each page and across them", async () => {
    for (const index of [3, 1, 2, 700, 650]) {
      reached.add(all[index]!.id!.toString());
    }

    expect(
      namesOf(
        await SourceLocator.getLocatableRepositories({
          projectId: PROJECT_ID,
          props: READER,
        }),
      ),
    ).toEqual([
      "repository-00002",
      "repository-00003",
      "repository-00004",
      "repository-00651",
      "repository-00701",
    ]);
  });

  test("told how many it needs, it stops at the page that has them", async () => {
    for (let index: number = 0; index < 30; index++) {
      reached.add(all[index]!.id!.toString());
    }

    const locatable: Array<LocatableRepositoryWithTree> =
      await SourceLocator.getLocatableRepositories({
        projectId: PROJECT_ID,
        props: READER,
        limit: MAX_REPOSITORIES_PROBED,
      });

    expect(locatable).toHaveLength(MAX_REPOSITORIES_PROBED);
    expect(pagesRead).toHaveLength(1);
  });

  test("a readiness check needs one: the first, and one page", async () => {
    reached.add(all[5]!.id!.toString());
    reached.add(all[900]!.id!.toString());

    const locatable: Array<LocatableRepositoryWithTree> =
      await SourceLocator.getLocatableRepositories({
        projectId: PROJECT_ID,
        props: { isRoot: true },
        limit: 1,
      });

    expect(namesOf(locatable)).toEqual(["repository-00006"]);
    expect(pagesRead).toHaveLength(1);
  });

  test("none reached reads every page once, and finds none", async () => {
    expect(
      await SourceLocator.getLocatableRepositories({
        projectId: PROJECT_ID,
        props: READER,
      }),
    ).toEqual([]);
    expect(pagesRead).toHaveLength(3);
  });

  test("no repository at all: one empty page, nothing more read", async () => {
    all = [];

    expect(
      await SourceLocator.getLocatableRepositories({
        projectId: PROJECT_ID,
        props: READER,
      }),
    ).toEqual([]);
    expect(pagesRead).toHaveLength(1);
    expect(CodeHostAccess.getConnectionSummaries).not.toHaveBeenCalled();
  });

  test("a frame lookup asks for as many as it probes, and probes past the 500th", async () => {
    reached.add(all[1150]!.id!.toString());

    const locatable: SpyInstance<
      typeof SourceLocator.getLocatableRepositories
    > = jest.spyOn(SourceLocator, "getLocatableRepositories");
    const probed: Array<string> = [];

    jest
      .spyOn(SourceLocator, "getTreePaths")
      .mockImplementation(async (repository: LocatableRepositoryWithTree) => {
        probed.push(repository.name);
        return ["src/orders/parse.ts"];
      });

    const links: Awaited<ReturnType<typeof SourceLocator.locate>> =
      await SourceLocator.locate({
        projectId: PROJECT_ID,
        props: READER,
        frames: [{ fileName: "/app/src/orders/parse.ts", lineNumber: 4 }],
      });

    expect(locatable.mock.calls[0]![0]).toMatchObject({
      limit: MAX_REPOSITORIES_PROBED,
    });
    expect(probed).toEqual(["repository-01151"]);
    expect(links).toHaveLength(1);
    expect(links[0]!.repositoryName).toBe("repository-01151");
  });
});
