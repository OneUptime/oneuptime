import CodeRepositoryService from "../../../../../Server/Services/CodeRepositoryService";
import CodeHostAccess, {
  CONNECTION_SUMMARIES_READ_AT_ONCE,
  CodeHostConnectionState,
  CodeHostConnectionSummary,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostAccess";
import GitHubInstallationBinding from "../../../../../Server/Utils/CodeRepository/GitHub/GitHubInstallationBinding";
import CodeRepository from "../../../../../Models/DatabaseModels/CodeRepository";
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
import type { SpyInstance } from "jest-mock";

/*
 * HOW EACH OF MANY REPOSITORIES CONNECTS, READ IN BATCHES (#10764).
 *
 * Code's Repositories page places every repository the reader may read in
 * its list - those AI can work in, and those it cannot - so it asks how
 * thousands connect at once. One statement naming every id would outgrow
 * what Postgres binds, so the repositories are read a batch at a time; the
 * project's GitHub installation and the connections are read once.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "2b7c4e1a-9d3f-4a6b-8c5d-1e2f3a4b5c6d",
);
const INSTALLATION_ID: string = "4242";

let rows: Map<string, CodeRepository>;
let findBy: SpyInstance<typeof CodeRepositoryService.findBy>;

beforeEach(() => {
  rows = new Map<string, CodeRepository>();

  findBy = jest
    .spyOn(CodeRepositoryService, "findBy")
    .mockImplementation((async (data: { query: { _id: unknown } }) => {
      const parameters: Record<string, unknown> =
        (
          data.query._id as {
            objectLiteralParameters?: Record<string, unknown>;
          }
        ).objectLiteralParameters || {};
      const asked: Array<string> = (
        (Object.values(parameters)[0] as Array<unknown> | undefined) || []
      ).map((id: unknown): string => {
        return String(id);
      });

      return asked
        .map((id: string): CodeRepository | undefined => {
          return rows.get(id);
        })
        .filter((row: CodeRepository | undefined): row is CodeRepository => {
          return Boolean(row);
        });
    }) as never);
  jest
    .spyOn(GitHubInstallationBinding, "getBoundInstallationId")
    .mockResolvedValue(INSTALLATION_ID);
  jest.spyOn(CodeHostAccess, "readConnections").mockResolvedValue(new Map());
});

afterEach(() => {
  jest.restoreAllMocks();
});

function addRepositories(count: number): Array<ObjectID> {
  const ids: Array<ObjectID> = [];

  for (let index: number = 0; index < count; index++) {
    const row: CodeRepository = new CodeRepository();
    row._id = ObjectID.generate().toString();
    row.projectId = PROJECT_ID;
    row.repositoryHostedAt = CodeRepositoryType.GitHub;
    // Every third one reached by the project's GitHub App.
    row.gitHubAppInstallationId = index % 3 === 0 ? INSTALLATION_ID : "999";
    rows.set(row._id, row);
    ids.push(row.id!);
  }

  return ids;
}

describe("CodeHostAccess.getConnectionSummaries", () => {
  test("thousands of repositories are read a batch at a time, as OneUptime, in the project - each summarized", async () => {
    const ids: Array<ObjectID> = addRepositories(1100);

    const summaries: Map<string, CodeHostConnectionSummary> =
      await CodeHostAccess.getConnectionSummaries({
        projectId: PROJECT_ID,
        repositoryIds: ids,
      });

    expect(
      findBy.mock.calls.map((call: Array<unknown>): number => {
        return (call[0] as { limit: number }).limit;
      }),
    ).toEqual([
      CONNECTION_SUMMARIES_READ_AT_ONCE,
      CONNECTION_SUMMARIES_READ_AT_ONCE,
      1100 - 2 * CONNECTION_SUMMARIES_READ_AT_ONCE,
    ]);

    for (const call of findBy.mock.calls) {
      const data: {
        query: Record<string, unknown>;
        props: { isRoot?: boolean };
      } = call[0] as {
        query: Record<string, unknown>;
        props: { isRoot?: boolean };
      };

      expect(data.props.isRoot).toBe(true);
      expect((data.query["projectId"] as ObjectID).toString()).toBe(
        PROJECT_ID.toString(),
      );
    }

    expect(summaries.size).toBe(1100);
    // The last batch's are summarized like the first's.
    expect(summaries.get(ids[1098]!.toString())!.state).toBe(
      CodeHostConnectionState.Connected,
    );
    expect(summaries.get(ids[1099]!.toString())!.state).toBe(
      CodeHostConnectionState.GitHubNotConnected,
    );
    // The project's installation and the connections, once for all of them.
    expect(
      GitHubInstallationBinding.getBoundInstallationId,
    ).toHaveBeenCalledTimes(1);
    expect(CodeHostAccess.readConnections).toHaveBeenCalledTimes(1);
  });

  test("a few are one read, and none is no read", async () => {
    const ids: Array<ObjectID> = addRepositories(3);

    await CodeHostAccess.getConnectionSummaries({
      projectId: PROJECT_ID,
      repositoryIds: ids,
    });

    expect(findBy).toHaveBeenCalledTimes(1);

    findBy.mockClear();

    expect(
      (
        await CodeHostAccess.getConnectionSummaries({
          projectId: PROJECT_ID,
          repositoryIds: [],
        })
      ).size,
    ).toBe(0);
    expect(findBy).not.toHaveBeenCalled();
  });
});
