import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import ChangeEventService from "../../../../../Server/Services/ChangeEventService";
import CodeRepositoryService from "../../../../../Server/Services/CodeRepositoryService";
import ServiceService from "../../../../../Server/Services/ServiceService";
import GitHubUtil from "../../../../../Server/Utils/CodeRepository/GitHub/GitHub";
import GitHubCommits, {
  GitHubCommitRange,
} from "../../../../../Server/Utils/CodeRepository/GitHub/GitHubCommits";
import * as CodeTools from "../../../../../Server/Utils/AI/Toolbox/CodeTools";
import CodeHostCommits, {
  CodeHostCommitReader,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostCommits";
import CodeRepositoryType from "../../../../../Types/CodeRepository/CodeRepositoryType";
import {
  GetChangeDetailsTool,
  isPreviousDeployOf,
} from "../../../../../Server/Utils/AI/Toolbox/ChangeTools";
import AIToolbox from "../../../../../Server/Utils/AI/Toolbox/Index";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../../Server/Utils/AI/Toolbox/ToolTypes";
import { AIChatCitationTargetType } from "../../../../../Types/AI/AIChatTypes";
import LessThan from "../../../../../Types/BaseDatabase/LessThan";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";

/*
 * get_change_details: one recorded change, and what a deploy that names a
 * commit shipped - the commits since the service's previous deploy, or its
 * one commit and the pull requests it came from - read only from a
 * repository the caller may read.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "9c4e2a10-0000-4000-8000-000000000001",
);
const CHANGE_ID: ObjectID = new ObjectID(
  "9c4e2a10-0000-4000-8000-000000000002",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "9c4e2a10-0000-4000-8000-000000000003",
);
const REPOSITORY_ID: ObjectID = new ObjectID(
  "9c4e2a10-0000-4000-8000-000000000004",
);
const HEAD: string = "2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c";
const BASE: string = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b";
const TIME: Date = new Date("2026-10-19T09:48:00.000Z");

function context(): ToolContext {
  return {
    projectId: PROJECT_ID,
    props: {
      tenantId: PROJECT_ID,
      userId: ObjectID.generate(),
      userGlobalAccessPermission: {
        globalPermissions: [Permission.Public],
        projectIds: [PROJECT_ID],
        _type: "UserGlobalAccessPermission",
      },
      userTenantAccessPermission: {
        [PROJECT_ID.toString()]: {
          projectId: PROJECT_ID,
          permissions: [
            {
              permission: Permission.ProjectMember,
              labelIds: [],
              isBlockPermission: false,
              _type: "UserPermission",
            },
          ],
          _type: "UserTenantAccessPermission",
        },
      },
    } as unknown as DatabaseCommonInteractionProps,
  };
}

function change(overrides: JSONObject = {}): JSONObject {
  return {
    _id: CHANGE_ID.toString(),
    time: TIME,
    eventType: "deployment",
    title: "Deploy 2.3.1",
    description: "Release train 42",
    primaryEntityId: SERVICE_ID,
    attributes: {
      "service.version": "2.3.1",
      "oneuptime.change.previous_version": "2.3.0",
      "vcs.ref.head.revision": HEAD,
      "vcs.repository.url.full": "https://github.com/acme/checkout",
      "deployment.environment.name": "production",
      "oneuptime.change.source": "api",
    },
    ...overrides,
  };
}

function repository(overrides: JSONObject = {}): JSONObject {
  return {
    _id: REPOSITORY_ID.toString(),
    id: REPOSITORY_ID,
    organizationName: "acme",
    repositoryName: "checkout",
    gitHubAppInstallationId: "4242",
    ...overrides,
  };
}

const RANGE: GitHubCommitRange = {
  status: "ahead",
  totalCommits: 2,
  commits: [
    {
      sha: HEAD,
      message: "Compute totals in cents (#482)",
      authorName: "Dana",
      authorLogin: "dana",
      pullRequestNumbers: [482],
    },
    {
      sha: "3c4d5e6f7a8b9c0d1e2f",
      message: "Bump lodash",
      authorName: "Bot",
      pullRequestNumbers: [],
    },
  ],
  files: [
    {
      path: "src/checkout/total.ts",
      status: "modified",
      additions: 12,
      deletions: 4,
    },
  ],
  isTruncated: false,
};

let findChanges: SpyInstance<typeof ChangeEventService.findBy>;
let readable: SpyInstance<typeof CodeTools.findReadableRepositories>;
let mintToken: SpyInstance<typeof GitHubUtil.getInstallationAccessToken>;
let compare: SpyInstance<typeof GitHubCommits.compare>;
let getCommit: SpyInstance<typeof GitHubCommits.getCommit>;
let listPullRequests: SpyInstance<
  typeof GitHubCommits.listPullRequestsForCommit
>;
let earlier: Array<JSONObject>;

beforeEach(() => {
  earlier = [
    change({
      _id: ObjectID.generate().toString(),
      attributes: { "vcs.ref.head.revision": HEAD },
    }),
    change({
      _id: ObjectID.generate().toString(),
      attributes: { "vcs.ref.head.revision": BASE },
    }),
  ];

  findChanges = jest
    .spyOn(ChangeEventService, "findBy")
    .mockImplementation((async (data: { limit: number }) => {
      // The first read is the change itself; the next, the service's earlier ones.
      return data.limit === 1 ? [change()] : earlier;
    }) as never);
  jest
    .spyOn(ServiceService, "findOneBy")
    .mockResolvedValue({ name: "checkout" } as never);
  readable = jest
    .spyOn(CodeTools, "findReadableRepositories")
    .mockResolvedValue([repository()] as never);
  mintToken = jest
    .spyOn(GitHubUtil, "getInstallationAccessToken")
    .mockResolvedValue({ token: "tok", expiresAt: new Date() });
  compare = jest.spyOn(GitHubCommits, "compare").mockResolvedValue(RANGE);
  getCommit = jest.spyOn(GitHubCommits, "getCommit").mockResolvedValue({
    commit: RANGE.commits[0]!,
    files: RANGE.files,
  });
  listPullRequests = jest
    .spyOn(GitHubCommits, "listPullRequestsForCommit")
    .mockResolvedValue([
      {
        number: 482,
        title: "Compute totals in cents",
        authorLogin: "dana",
        mergedAt: "2026-10-19T09:30:00Z",
        url: "https://github.com/acme/checkout/pull/482",
      },
    ]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function run(
  changeId: string = CHANGE_ID.toString(),
): Promise<ToolExecutionResult> {
  return await GetChangeDetailsTool.execute({ changeId }, context());
}

describe("get_change_details", () => {
  test("a deploy, and the commits since the service's previous deploy", async () => {
    const result: ToolExecutionResult = await run();

    expect(result.dataForLlm.split("\n")).toEqual([
      `- kind=change | at=2026-10-19T09:48:00.000Z | type=deployment | title=Deploy 2.3.1 | service=checkout | version=2.3.1 | previousVersion=2.3.0 | commit=2b3c4d5 | repository=https://github.com/acme/checkout | environment=production | recordedFrom=the change-events API | description=Release train 42`,
      "- kind=range | repository=acme/checkout | from=1a2b3c4 | commits=2 | status=ahead",
      "- kind=commit | sha=2b3c4d5 | author=dana | message=Compute totals in cents (#482) | pullRequests=#482",
      "- kind=commit | sha=3c4d5e6 | author=Bot | message=Bump lodash",
      "- kind=file | path=src/checkout/total.ts | status=modified | changes=+12 -4",
    ]);
    expect(compare).toHaveBeenCalledWith({
      token: "tok",
      owner: "acme",
      repository: "checkout",
      base: BASE,
      head: HEAD,
    });
    expect(result.citationLabel).toBe("Change Deploy 2.3.1 (2 commits)");
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.ServiceView,
      params: { serviceId: SERVICE_ID.toString() },
    });
  });

  test("reads as the caller: the change, the service, the repositories and the earlier changes", async () => {
    const ctx: ToolContext = context();

    await GetChangeDetailsTool.execute({ changeId: CHANGE_ID.toString() }, ctx);

    const first: JSONObject = findChanges.mock.calls[0]![0] as never;
    expect(first["props"]).toBe(ctx.props);
    expect((first["query"] as JSONObject)["_id"]).toEqual(CHANGE_ID);

    const second: JSONObject = findChanges.mock.calls[1]![0] as never;
    expect(second["props"]).toBe(ctx.props);
    const query: JSONObject = second["query"] as JSONObject;
    expect(query["primaryEntityId"]).toEqual(SERVICE_ID);
    expect(query["time"]).toBeInstanceOf(LessThan);
    expect((query["time"] as unknown as LessThan<Date>).value).toEqual(TIME);

    expect(readable).toHaveBeenCalledWith(ctx);
    expect(mintToken).toHaveBeenCalledWith("4242", {
      permissions: {
        contents: "read",
        pull_requests: "read",
        metadata: "read",
      },
    });
  });

  test("a first deploy lists its commit and the pull requests it came from", async () => {
    earlier = [];

    const result: ToolExecutionResult = await run();

    expect(compare).not.toHaveBeenCalled();
    expect(getCommit).toHaveBeenCalledWith({
      token: "tok",
      owner: "acme",
      repository: "checkout",
      sha: HEAD,
    });
    expect(listPullRequests).toHaveBeenCalledTimes(1);
    expect(result.dataForLlm).toContain(
      "- kind=range | repository=acme/checkout | commits=1 | note=no earlier deploy of this service names a commit, so only this commit is listed",
    );
    expect(result.dataForLlm).toContain(
      "- kind=pull_request | number=482 | title=Compute totals in cents | author=dana | mergedAt=2026-10-19T09:30:00Z | url=https://github.com/acme/checkout/pull/482",
    );
    expect(result.dataForLlm).toContain(
      "- kind=file | path=src/checkout/total.ts",
    );
    expect(result.citationLabel).toBe("Change Deploy 2.3.1 (1 commit)");
  });

  test("without a repository URL, the service's repository is resolved", async () => {
    findChanges.mockImplementation((async (data: { limit: number }) => {
      return data.limit === 1
        ? [change({ attributes: { "vcs.ref.head.revision": HEAD } })]
        : earlier;
    }) as never);
    const resolve: SpyInstance<
      typeof CodeRepositoryService.resolveRepositoryForException
    > = jest
      .spyOn(CodeRepositoryService, "resolveRepositoryForException")
      .mockResolvedValue({
        codeRepositoryId: REPOSITORY_ID.toString(),
        organizationName: "acme",
        repositoryName: "checkout",
        servicePathInRepository: null,
        method: "name-match",
        evidence: "",
      });

    const result: ToolExecutionResult = await run();

    expect(resolve).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      stackTrace: null,
      serviceName: "checkout",
    });
    expect(result.dataForLlm).toContain(
      "kind=range | repository=acme/checkout",
    );
  });

  test("a repository the caller cannot read is never read from", async () => {
    readable.mockResolvedValue([]);

    const result: ToolExecutionResult = await run();

    expect(mintToken).not.toHaveBeenCalled();
    expect(result.dataForLlm).toContain(
      "kind=note | text=No repository connected to OneUptime that you may read matches this change",
    );
  });

  test("a repository URL that names another repository is not this one", async () => {
    readable.mockResolvedValue([
      repository({ organizationName: "acme", repositoryName: "billing" }),
    ] as never);

    const result: ToolExecutionResult = await run();

    expect(mintToken).not.toHaveBeenCalled();
    expect(result.dataForLlm).toContain("kind=note");
  });

  test("a commit that is not a SHA is not looked up", async () => {
    findChanges.mockImplementation((async () => {
      return [
        change({
          attributes: {
            "vcs.ref.head.revision": "release-2026-10-19",
          },
        }),
      ];
    }) as never);

    const result: ToolExecutionResult = await run();

    expect(readable).not.toHaveBeenCalled();
    expect(result.dataForLlm).toContain(
      'kind=note | text=The change names "release-2026-10-19" as its commit, which is not a commit SHA',
    );
  });

  test("GitHub failing leaves the change described", async () => {
    compare.mockRejectedValue(new Error("rate limited"));
    getCommit.mockRejectedValue(new Error("rate limited"));

    const result: ToolExecutionResult = await run();

    expect(result.dataForLlm.split("\n")[0]).toContain("kind=change");
    expect(result.dataForLlm).toContain(
      "kind=note | text=The commits this change shipped could not be read from GitHub.",
    );
  });

  /*
   * The previous deploy's commit may not be in the repository (a pipeline
   * posted another repository's commit) or may have been force-pushed
   * away: GitHub answers 404 and the deploy's own commit is still worth
   * listing.
   */
  test("a compare GitHub cannot make falls back to the commit itself", async () => {
    compare.mockRejectedValue(new Error("404 No common ancestor"));

    const result: ToolExecutionResult = await run();

    expect(getCommit).toHaveBeenCalledTimes(1);
    expect(listPullRequests).toHaveBeenCalledTimes(1);
    expect(result.dataForLlm).toContain(
      "- kind=range | repository=acme/checkout | commits=1 | note=the previous deploy's commit (1a2b3c4) could not be compared with this one, so only this commit is listed",
    );
    expect(result.dataForLlm).toContain("- kind=pull_request | number=482");
    expect(result.dataForLlm).not.toContain("kind=note");
  });

  test("a deploy of an older commit than the previous one is a rollback", async () => {
    compare.mockResolvedValue({
      status: "behind",
      totalCommits: 0,
      commits: [],
      files: [],
      isTruncated: false,
    });

    const result: ToolExecutionResult = await run();

    expect(result.dataForLlm).toContain(
      "- kind=range | repository=acme/checkout | from=1a2b3c4 | commits=0 | status=behind | note=this commit is older than the previous deploy's (1a2b3c4): the change rolled back",
    );
  });

  test("the previous deploy is the one in the same environment and repository", async () => {
    const STAGING: string = "4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e";
    const OTHER_REPOSITORY: string = "5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f";
    earlier = [
      // The same commit, abbreviated: not the deploy before this one.
      change({
        _id: ObjectID.generate().toString(),
        attributes: { "vcs.ref.head.revision": HEAD.slice(0, 7) },
      }),
      change({
        _id: ObjectID.generate().toString(),
        attributes: {
          "vcs.ref.head.revision": STAGING,
          "deployment.environment.name": "staging",
        },
      }),
      change({
        _id: ObjectID.generate().toString(),
        attributes: {
          "vcs.ref.head.revision": OTHER_REPOSITORY,
          "vcs.repository.url.full": "https://github.com/acme/payments",
        },
      }),
      change({
        _id: ObjectID.generate().toString(),
        attributes: {
          "vcs.ref.head.revision": BASE,
          "deployment.environment.name": "Production",
          "vcs.repository.url.full": "git@github.com:acme/checkout.git",
        },
      }),
    ];

    await run();

    expect(compare).toHaveBeenCalledTimes(1);
    expect(compare.mock.calls[0]![0].base).toBe(BASE);
  });

  test("a deploy with no commit says how to send one", async () => {
    findChanges.mockImplementation((async () => {
      return [change({ attributes: { "service.version": "2.3.1" } })];
    }) as never);

    const result: ToolExecutionResult = await run();

    expect(readable).not.toHaveBeenCalled();
    expect(result.dataForLlm).toContain(
      "kind=note | text=This change names no commit, so what it shipped is not known.",
    );
  });

  test("a change that is not a deploy and names no commit is just described", async () => {
    findChanges.mockImplementation((async () => {
      return [
        change({
          eventType: "remediation",
          title:
            "OneUptime AI ran kubectl rollout restart deployment/api -n web",
          primaryEntityId: null,
          attributes: {
            "oneuptime.change.source": "oneuptime-ai",
            "oneuptime.change.status": "succeeded",
            "oneuptime.command":
              "kubectl rollout restart deployment/api -n web",
            "k8s.namespace.name": "web",
            "k8s.deployment.name": "api",
          },
        }),
      ];
    }) as never);

    const result: ToolExecutionResult = await run();

    expect(result.dataForLlm).toBe(
      "- kind=change | at=2026-10-19T09:48:00.000Z | type=remediation | title=OneUptime AI ran kubectl rollout restart deployment/api -n web | deployment=api | namespace=web | command=kubectl rollout restart deployment/api -n web | status=succeeded | recordedFrom=a fix OneUptime AI ran | description=Release train 42",
    );
    expect(result.citationTarget).toBeUndefined();
    expect(result.citationLabel).toBe(
      "Change OneUptime AI ran kubectl rollout restart deployment/api -n web",
    );
  });

  test("a change that cannot be found, or read, says so", async () => {
    findChanges.mockResolvedValue([]);

    const result: ToolExecutionResult = await run();

    expect(result.rowCount).toBe(0);
    expect(result.dataForLlm).toBe(
      `No change with id ${CHANGE_ID.toString()} was found that you may read.`,
    );
  });

  test("a changeId that is not an id is refused before anything is read", async () => {
    await expect(run("deploy-123")).rejects.toThrow(BadDataException);
    await expect(GetChangeDetailsTool.execute({}, context())).rejects.toThrow(
      "changeId must be the id of a change",
    );
    expect(findChanges).not.toHaveBeenCalled();
  });

  test("is a read-only tool behind the same gate as recent_changes", () => {
    expect(AIToolbox.getToolByName("get_change_details")).toBe(
      GetChangeDetailsTool,
    );
    expect(AIToolbox.isMutationTool("get_change_details")).toBe(false);
    expect(GetChangeDetailsTool.requiredPermissions).toEqual(
      new Monitor().getReadPermissions(),
    );
  });
});

describe("isPreviousDeployOf", () => {
  const current: {
    commitSha: string;
    environment: string;
    repositoryUrl: string;
  } = {
    commitSha: HEAD,
    environment: "production",
    repositoryUrl: "https://github.com/acme/checkout",
  };

  test("another commit of the same environment and repository is", () => {
    expect(isPreviousDeployOf(current, { ...current, commitSha: BASE })).toBe(
      true,
    );
  });

  test("an earlier change that names no environment or repository may be", () => {
    expect(isPreviousDeployOf(current, { commitSha: BASE })).toBe(true);
    expect(isPreviousDeployOf({ commitSha: HEAD }, current)).toBe(false);
    expect(
      isPreviousDeployOf({ commitSha: HEAD }, { ...current, commitSha: BASE }),
    ).toBe(true);
  });

  test("a change with no commit, or with this one, is not", () => {
    expect(isPreviousDeployOf(current, { environment: "production" })).toBe(
      false,
    );
    expect(isPreviousDeployOf(current, { commitSha: HEAD.toUpperCase() })).toBe(
      false,
    );
    expect(isPreviousDeployOf(current, { commitSha: HEAD.slice(0, 8) })).toBe(
      false,
    );
    expect(
      isPreviousDeployOf({ commitSha: HEAD.slice(0, 7) }, { commitSha: HEAD }),
    ).toBe(false);
  });

  test("another environment is not, whatever its case", () => {
    expect(
      isPreviousDeployOf(current, {
        commitSha: BASE,
        environment: "staging",
      }),
    ).toBe(false);
    expect(
      isPreviousDeployOf(current, {
        commitSha: BASE,
        environment: "PRODUCTION",
      }),
    ).toBe(true);
  });

  test("another repository is not, however its address is written", () => {
    expect(
      isPreviousDeployOf(current, {
        commitSha: BASE,
        repositoryUrl: "https://github.com/acme/payments",
      }),
    ).toBe(false);
    for (const repositoryUrl of [
      "git@github.com:acme/checkout.git",
      "https://github.com/ACME/Checkout/",
      "acme/checkout",
    ]) {
      expect(
        isPreviousDeployOf(current, { commitSha: BASE, repositoryUrl }),
      ).toBe(true);
    }
    // Addresses that are not GitHub's are compared as written.
    expect(
      isPreviousDeployOf(
        { ...current, repositoryUrl: "https://gitlab.example.com/acme/x" },
        {
          commitSha: BASE,
          repositoryUrl: "https://gitlab.example.com/acme/y",
        },
      ),
    ).toBe(false);
  });
});

/*
 * A deploy of a GitLab, Forgejo or Gitea repository lists what it shipped
 * too, read through the repository's connection (CodeHostCommits): GitLab's
 * merge requests are named as such ("!12"), and Forgejo's and Gitea's
 * files say which and how, without lines they do not count. A Git server
 * has no API for commits, and a connection that does not work is said.
 */
describe("get_change_details: a deploy of a repository beyond GitHub", () => {
  const GITLAB_URL: string = "https://gitlab.example.com/acme/backend/checkout";
  let openReader: SpyInstance<typeof CodeHostCommits.openForRepository>;
  let reader: CodeHostCommitReader;

  function onHost(
    type: CodeRepositoryType,
    repositoryUrl: string,
    organizationName: string = "acme/backend",
  ): void {
    findChanges.mockImplementation((async (data: { limit: number }) => {
      return data.limit === 1
        ? [
            change({
              attributes: {
                "vcs.ref.head.revision": HEAD,
                "vcs.repository.url.full": repositoryUrl,
                "deployment.environment.name": "production",
              },
            }),
          ]
        : earlier;
    }) as never);
    readable.mockResolvedValue([
      repository({
        organizationName,
        repositoryName: "checkout",
        repositoryHostedAt: type,
      }),
    ] as never);
  }

  beforeEach(() => {
    reader = {
      provider: CodeRepositoryType.GitLab,
      pullRequestTerm: "merge request",
      compare: jest.fn(async () => {
        return {
          status: "ahead",
          totalCommits: 1,
          commits: [
            {
              sha: HEAD,
              message: "Merge branch 'fix' into 'main'",
              authorName: "Dana",
              pullRequestNumbers: [12],
            },
          ],
          files: [
            {
              path: "src/checkout/total.ts",
              status: "modified",
              additions: 3,
              deletions: 1,
            },
          ],
          isTruncated: false,
        };
      }) as never,
      getCommit: jest.fn(async () => {
        return {
          commit: {
            sha: HEAD,
            message: "fix: totals",
            authorName: "Dana",
            pullRequestNumbers: [],
          },
          files: [{ path: "src/a.ts", status: "added" }],
        };
      }) as never,
      listPullRequestsForCommit: jest.fn(async () => {
        return [
          {
            number: 12,
            title: "Fix totals",
            url: "https://gitlab.example.com/acme/backend/checkout/-/merge_requests/12",
          },
        ];
      }) as never,
    };
    openReader = jest
      .spyOn(CodeHostCommits, "openForRepository")
      .mockResolvedValue(reader);
  });

  test("a GitLab deploy: the commits since the previous one, through its connection, merge requests named !12", async () => {
    onHost(CodeRepositoryType.GitLab, GITLAB_URL);
    earlier = [
      change({
        _id: ObjectID.generate().toString(),
        attributes: {
          "vcs.ref.head.revision": BASE,
          "vcs.repository.url.full":
            "git@gitlab.example.com:acme/backend/checkout.git",
          "deployment.environment.name": "production",
        },
      }),
    ];

    const result: ToolExecutionResult = await run();

    expect(openReader).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      repositoryId: REPOSITORY_ID,
    });
    expect(reader.compare).toHaveBeenCalledWith({ base: BASE, head: HEAD });
    expect(mintToken).not.toHaveBeenCalled();
    expect(result.dataForLlm).toContain(
      "- kind=range | repository=acme/backend/checkout | from=1a2b3c4 | commits=1 | status=ahead",
    );
    expect(result.dataForLlm).toContain(
      "- kind=commit | sha=2b3c4d5 | author=Dana | message=Merge branch 'fix' into 'main' | mergeRequests=!12",
    );
    expect(result.dataForLlm).toContain(
      "- kind=file | path=src/checkout/total.ts | status=modified | changes=+3 -1",
    );
  });

  test("a first deploy on GitLab lists its commit and the merge requests it came from, as merge requests", async () => {
    onHost(CodeRepositoryType.GitLab, GITLAB_URL);
    earlier = [];

    const result: ToolExecutionResult = await run();

    expect(result.dataForLlm).toContain(
      "- kind=merge_request | number=12 | title=Fix totals",
    );
    // Forgejo's and Gitea's files are not counted: no changes are made up.
    expect(result.dataForLlm).toContain(
      "- kind=file | path=src/a.ts | status=added",
    );
    expect(result.dataForLlm).not.toContain("changes=+");
  });

  test("a github.com address never matches a repository on another host of the same path", async () => {
    onHost(
      CodeRepositoryType.Forgejo,
      "https://github.com/acme/checkout",
      "acme",
    );

    const result: ToolExecutionResult = await run();

    expect(openReader).not.toHaveBeenCalled();
    expect(result.dataForLlm).toContain(
      "No repository connected to OneUptime that you may read matches this change",
    );
  });

  test("a Git server has no API for commits, and says so", async () => {
    onHost(CodeRepositoryType.Git, GITLAB_URL);

    const result: ToolExecutionResult = await run();

    expect(openReader).not.toHaveBeenCalled();
    expect(result.dataForLlm).toContain(
      "is on a Git server, which has no API OneUptime reads commits through",
    );
  });

  test("a connection that does not work now is said, naming the host", async () => {
    onHost(CodeRepositoryType.GitLab, GITLAB_URL);
    openReader.mockResolvedValue(null);

    const result: ToolExecutionResult = await run();

    expect(result.dataForLlm).toContain(
      "is not reached through its GitLab connection now, so the commits it shipped are not listed.",
    );
  });

  test("GitLab failing leaves the change described, naming GitLab", async () => {
    onHost(CodeRepositoryType.GitLab, GITLAB_URL);
    earlier = [];
    reader.getCommit = jest.fn(async () => {
      throw new Error("GitLab answered 502");
    }) as never;

    const result: ToolExecutionResult = await run();

    expect(result.dataForLlm.split("\n")[0]).toContain("kind=change");
    expect(result.dataForLlm).toContain(
      "kind=note | text=The commits this change shipped could not be read from GitLab.",
    );
  });
});

describe("isPreviousDeployOf, on any host", () => {
  test("the same GitLab repository however its address is written, and not another server's", () => {
    const current: { commitSha: string; repositoryUrl: string } = {
      commitSha: HEAD,
      repositoryUrl: "https://gitlab.example.com/acme/backend/checkout",
    };

    for (const repositoryUrl of [
      "git@gitlab.example.com:acme/backend/checkout.git",
      "https://gitlab.example.com/ACME/backend/checkout.git/",
      "ssh://git@gitlab.example.com:2222/acme/backend/checkout",
    ]) {
      expect(
        isPreviousDeployOf(current, { commitSha: BASE, repositoryUrl }),
      ).toBe(true);
    }

    expect(
      isPreviousDeployOf(current, {
        commitSha: BASE,
        repositoryUrl: "https://gitlab.other.com/acme/backend/checkout",
      }),
    ).toBe(false);
    expect(
      isPreviousDeployOf(current, {
        commitSha: BASE,
        repositoryUrl: "https://gitlab.example.com/acme/backend/billing",
      }),
    ).toBe(false);
  });
});
