import CodeRepositoryService from "../../../../Server/Services/CodeRepositoryService";
import CodeTaskAccess from "../../../../Server/Utils/AI/CodeTask/CodeTaskAccess";
import CodeTaskRepositoryList from "../../../../Server/Utils/AI/CodeTask/CodeTaskRepositoryList";
import CodeHostAccess, {
  CodeHostConnectionState,
  CodeHostConnectionSummary,
} from "../../../../Server/Utils/CodeRepository/CodeHost/CodeHostAccess";
import SourceLocator, {
  LocatableRepositoryWithTree,
} from "../../../../Server/Utils/CodeRepository/SourceLocator";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import URL from "../../../../Types/API/URL";
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

/*
 * WHICH REPOSITORIES ONEUPTIME READS THE CODE OF: THE PICKER'S RULE IS
 * SOURCELOCATOR'S (#10921).
 *
 * A finding's and a profile's Fix with AI work in a repository SourceLocator
 * finds (getLocatableRepositories) and refuse any other. Their pickers search
 * Code's repository list held to the same set (codeReadableOnly), judged by
 * CodeReadableRepository. If the two rules ever drifted apart, a picker
 * would offer a repository its fix then refuses, or leave out one it takes:
 * here every kind of repository is weighed by both, and they agree.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "2b7c4e1a-9d3f-4a6b-8c5d-1e2f3a4b5c6d",
);
const READER: DatabaseCommonInteractionProps = {
  userId: new ObjectID("7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"),
  tenantId: PROJECT_ID,
} as DatabaseCommonInteractionProps;

interface Case {
  name: string;
  hostedAt: CodeRepositoryType;
  organizationName?: string | undefined;
  repositoryName?: string | undefined;
  repositoryUrl?: string | undefined;
  // How it connects: none for a repository with no connection summary.
  summary: {
    state: CodeHostConnectionState;
    isReachableFromServer: boolean;
  } | null;
}

// Every kind of repository that weighs differently, by one fact at a time.
const CASES: Array<Case> = [
  {
    name: "github-connected",
    hostedAt: CodeRepositoryType.GitHub,
    summary: {
      state: CodeHostConnectionState.Connected,
      isReachableFromServer: true,
    },
  },
  {
    name: "github-not-connected",
    hostedAt: CodeRepositoryType.GitHub,
    summary: {
      state: CodeHostConnectionState.GitHubNotConnected,
      isReachableFromServer: true,
    },
  },
  {
    name: "gitlab-connected",
    hostedAt: CodeRepositoryType.GitLab,
    summary: {
      state: CodeHostConnectionState.Connected,
      isReachableFromServer: true,
    },
  },
  {
    name: "gitlab-private-network",
    hostedAt: CodeRepositoryType.GitLab,
    summary: {
      state: CodeHostConnectionState.Connected,
      isReachableFromServer: false,
    },
  },
  {
    name: "gitlab-token-refused",
    hostedAt: CodeRepositoryType.GitLab,
    summary: {
      state: CodeHostConnectionState.TokenRefused,
      isReachableFromServer: true,
    },
  },
  {
    name: "forgejo-connection-gone",
    hostedAt: CodeRepositoryType.Forgejo,
    summary: {
      state: CodeHostConnectionState.NoConnection,
      isReachableFromServer: true,
    },
  },
  {
    name: "forgejo-connected",
    hostedAt: CodeRepositoryType.Forgejo,
    summary: {
      state: CodeHostConnectionState.Connected,
      isReachableFromServer: true,
    },
  },
  {
    name: "git-on-azure-devops",
    hostedAt: CodeRepositoryType.Git,
    repositoryUrl: "https://dev.azure.com/acme/Shop/_git/git-on-azure-devops",
    summary: {
      state: CodeHostConnectionState.Connected,
      isReachableFromServer: true,
    },
  },
  {
    name: "git-elsewhere",
    hostedAt: CodeRepositoryType.Git,
    repositoryUrl: "https://git.example.com/team/git-elsewhere.git",
    summary: {
      state: CodeHostConnectionState.Connected,
      isReachableFromServer: true,
    },
  },
  {
    name: "git-no-address",
    hostedAt: CodeRepositoryType.Git,
    summary: {
      state: CodeHostConnectionState.Connected,
      isReachableFromServer: true,
    },
  },
  {
    name: "no-owner",
    hostedAt: CodeRepositoryType.GitHub,
    organizationName: "",
    summary: {
      state: CodeHostConnectionState.Connected,
      isReachableFromServer: true,
    },
  },
  {
    name: "no-name-on-its-host",
    hostedAt: CodeRepositoryType.GitHub,
    repositoryName: "",
    summary: {
      state: CodeHostConnectionState.Connected,
      isReachableFromServer: true,
    },
  },
  {
    name: "no-summary",
    hostedAt: CodeRepositoryType.GitHub,
    summary: null,
  },
];

let rows: Array<CodeRepository>;
let summaries: Map<string, CodeHostConnectionSummary>;

beforeEach(() => {
  rows = [];
  summaries = new Map<string, CodeHostConnectionSummary>();

  for (const item of CASES) {
    const row: CodeRepository = new CodeRepository();

    row._id = ObjectID.generate().toString();
    row.name = item.name;
    row.organizationName =
      item.organizationName === undefined ? "acme" : item.organizationName;
    row.repositoryName =
      item.repositoryName === undefined ? item.name : item.repositoryName;
    row.repositoryHostedAt = item.hostedAt;
    row.mainBranchName = "main";
    row.gitHubAppInstallationId = "4242";

    if (item.repositoryUrl) {
      row.repositoryUrl = URL.fromString(item.repositoryUrl);
    }

    rows.push(row);

    if (item.summary) {
      summaries.set(row.id!.toString(), {
        connectionId: null,
        provider: item.hostedAt,
        hostUrl: null,
        hostProduct: null,
        accountLogin: null,
        credentialHint: null,
        state: item.summary.state,
        isReachableFromServer: item.summary.isReachableFromServer,
      });
    }
  }

  // SourceLocator's reads: the person's repositories, how each connects, and the rows as root.
  jest
    .spyOn(CodeTaskAccess, "readReadableRepositoriesPage")
    .mockImplementation(async (data: { skip: number; limit: number }) => {
      return rows.slice(data.skip, data.skip + data.limit);
    });
  jest
    .spyOn(CodeHostAccess, "getConnectionSummaries")
    .mockImplementation(async (data: { repositoryIds: Array<ObjectID> }) => {
      const asked: Map<string, CodeHostConnectionSummary> = new Map();

      for (const id of data.repositoryIds) {
        const found: CodeHostConnectionSummary | undefined = summaries.get(
          id.toString(),
        );

        if (found) {
          asked.set(id.toString(), found);
        }
      }

      return asked;
    });
  jest.spyOn(CodeRepositoryService, "findBy").mockResolvedValue(rows as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the code-readable rule a Fix with AI picker is held to", () => {
  test("keeps exactly the repositories SourceLocator finds, of every kind", async () => {
    const located: Array<LocatableRepositoryWithTree> =
      await SourceLocator.getLocatableRepositories({
        projectId: PROJECT_ID,
        props: READER,
      });

    const held: Array<CodeRepository> = await CodeTaskRepositoryList.keepHeldTo(
      {
        props: READER,
        projectId: PROJECT_ID,
        repositories: rows,
        summaries,
        scope: { codeReadableOnly: true },
      },
    );

    const locatedNames: Array<string> = located
      .map((repository: LocatableRepositoryWithTree): string => {
        return repository.name;
      })
      .sort();
    const heldNames: Array<string> = held
      .map((repository: CodeRepository): string => {
        return repository.name || "";
      })
      .sort();

    expect(heldNames).toEqual(locatedNames);
    // And the set is what the rule says it is.
    expect(heldNames).toEqual(
      [
        "forgejo-connected",
        "git-on-azure-devops",
        "github-connected",
        "gitlab-connected",
      ].sort(),
    );
  });
});
