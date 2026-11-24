import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import { SecurityCaseFeedEventType } from "../../../Models/DatabaseModels/SecurityCaseFeed";
import SecurityCasePullRequest from "../../../Models/DatabaseModels/SecurityCasePullRequest";
import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import SecurityCaseFeedService from "../../../Server/Services/SecurityCaseFeedService";
import SecurityCasePullRequestService from "../../../Server/Services/SecurityCasePullRequestService";
import SecurityCaseService from "../../../Server/Services/SecurityCaseService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../../../Server/Types/Database/Hooks";
import { CodeHostPullRequestState } from "../../../Server/Utils/CodeRepository/CodeHost/CodeHostTypes";
import LinkedPullRequestReader, {
  LinkedPullRequestReadError,
  LinkedPullRequestReadProblem,
} from "../../../Server/Utils/CodeRepository/LinkedPullRequests/LinkedPullRequestReader";
import ProjectReferenceCheck from "../../../Server/Utils/Database/ProjectReferenceCheck";
import SecurityCasePullRequestFollower from "../../../Server/Utils/SecurityCase/SecurityCasePullRequestFollower";
import SecurityCaseStepChecks from "../../../Server/Utils/SecurityCase/StepChecks/SecurityCaseStepChecks";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import CodeRepositoryType from "../../../Types/CodeRepository/CodeRepositoryType";
import PullRequestState from "../../../Types/CodeRepository/PullRequestState";
import BadDataException from "../../../Types/Exception/BadDataException";
import { getRefusalText } from "../../../Types/Exception/RefusalWithValues";
import { JSONObject } from "../../../Types/JSON";
import {
  pullRequestLinkedMarkdown,
  pullRequestUnlinkedMarkdown,
} from "../../../Utils/SecurityCase/SecurityCaseMarkdown";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  PULL_REQUEST_LINK_ALREADY_LINKED,
  PULL_REQUEST_LINK_CASE_NOT_FOUND,
  PULL_REQUEST_LINK_CLOSED,
  PULL_REQUEST_LINK_NOT_AN_ADDRESS,
  PULL_REQUEST_LINK_NOT_CONNECTED,
  PULL_REQUEST_LINK_NOT_FOLLOWED,
  PULL_REQUEST_LINK_NOT_FOUND,
  PULL_REQUEST_LINK_READ_FAILED,
  PULL_REQUEST_LINK_REPOSITORY_NOT_READABLE,
  PULL_REQUEST_LINK_TOO_MANY,
  SECURITY_CASE_PULL_REQUESTS_MAX,
} from "../../../Types/SecurityCase/SecurityCasePullRequestLink";

/*
 * A person's own pull request, linked to a security case's Fix step
 * (#10604). Who may link one, and what a link is refused for, each with a
 * reason the person can act on: a case that is not there, too many links,
 * no pull request's address, a repository the project has not connected
 * under Code or the person may not read there, one linked already, a
 * connection that cannot read pull requests, a pull request the host does
 * not have or closed unmerged. What OneUptime read of it is written by
 * OneUptime, and linking or taking one off is on the case's timeline.
 *
 * No database: the services' reads and writes are spied, the hooks are
 * called as DatabaseService calls them.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CASE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const LINK_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const MAYA_ID: ObjectID = new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-000000000001");
const MERGE_SHA: string = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b";
const ADDRESS: string = "https://github.com/acme/search/pull/482/files";

type Hooks = {
  onBeforeCreate: (
    createBy: CreateBy<SecurityCasePullRequest>,
  ) => Promise<OnCreate<SecurityCasePullRequest>>;
  onCreateSuccess: (
    onCreate: OnCreate<SecurityCasePullRequest>,
    createdItem: SecurityCasePullRequest,
  ) => Promise<SecurityCasePullRequest>;
  onBeforeDelete: (
    deleteBy: DeleteBy<SecurityCasePullRequest>,
  ) => Promise<OnDelete<SecurityCasePullRequest>>;
  onDeleteSuccess: (
    onDelete: OnDelete<SecurityCasePullRequest>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ) => Promise<OnDelete<SecurityCasePullRequest>>;
  findRowsAndHoldDeleteToThem: (...args: Array<unknown>) => Promise<unknown>;
};

const hooks: Hooks = SecurityCasePullRequestService as unknown as Hooks;

// Maya, working the case.
const MAYA: DatabaseCommonInteractionProps = {
  userId: MAYA_ID,
  tenantId: PROJECT_ID,
};

const REPOSITORY: CodeRepository = ((): CodeRepository => {
  const row: CodeRepository = new CodeRepository();
  row.id = new ObjectID("44444444-4444-4444-8444-444444444444");
  row.projectId = PROJECT_ID;
  row.repositoryHostedAt = CodeRepositoryType.GitHub;
  row.organizationName = "acme";
  row.repositoryName = "search";
  return row;
})();

let feedItems: Array<JSONObject>;
let checksAsked: Array<JSONObject>;
let followed: Array<JSONObject>;
let linkedAlready: number;
let duplicates: number;
let repository: CodeRepository | null;
let readableByPerson: boolean;
let read: () => Promise<CodeHostPullRequestState>;
let caseFound: boolean;

beforeEach(() => {
  feedItems = [];
  checksAsked = [];
  followed = [];
  linkedAlready = 0;
  duplicates = 0;
  repository = REPOSITORY;
  readableByPerson = true;
  caseFound = true;
  read = async (): Promise<CodeHostPullRequestState> => {
    return { state: PullRequestState.Open };
  };

  jest
    .spyOn(ProjectReferenceCheck, "validateCreate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(SecurityCaseService, "findOneBy")
    .mockImplementation(async (): Promise<SecurityCase | null> => {
      if (!caseFound) {
        return null;
      }

      const found: SecurityCase = new SecurityCase();
      found.id = CASE_ID;
      return found;
    });
  jest
    .spyOn(SecurityCasePullRequestService, "countBy")
    .mockImplementation(async (args: unknown): Promise<PositiveNumber> => {
      const query: JSONObject = (args as { query: JSONObject }).query;

      return new PositiveNumber(
        query["pullRequestNumber"] !== undefined ? duplicates : linkedAlready,
      );
    });
  jest
    .spyOn(LinkedPullRequestReader, "findRepository")
    .mockImplementation(async (): Promise<CodeRepository | null> => {
      return repository;
    });
  jest
    .spyOn(LinkedPullRequestReader, "readState")
    .mockImplementation(async (): Promise<CodeHostPullRequestState> => {
      return await read();
    });
  jest
    .spyOn(CodeRepositoryService, "findOneBy")
    .mockImplementation(async (): Promise<CodeRepository | null> => {
      return readableByPerson ? REPOSITORY : null;
    });
  jest
    .spyOn(SecurityCaseFeedService, "createSecurityCaseFeedItem")
    .mockImplementation(async (args: unknown) => {
      feedItems.push(args as JSONObject);
      return undefined as never;
    });
  jest
    .spyOn(SecurityCaseStepChecks, "requestCheck")
    .mockImplementation(async (args: unknown): Promise<void> => {
      checksAsked.push(args as JSONObject);
    });
  jest
    .spyOn(SecurityCasePullRequestFollower, "followById")
    .mockImplementation(async (args: unknown) => {
      followed.push(args as JSONObject);
      return { isChanged: false, isShipped: false };
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function createBy(
  address: string = ADDRESS,
  props: DatabaseCommonInteractionProps = MAYA,
): CreateBy<SecurityCasePullRequest> {
  const data: SecurityCasePullRequest = new SecurityCasePullRequest();
  data.securityCaseId = CASE_ID;
  data.pullRequestUrl = URL.fromString(address);

  return { data, props };
}

async function refusal(
  build: CreateBy<SecurityCasePullRequest> = createBy(),
): Promise<string> {
  try {
    await hooks.onBeforeCreate(build);
  } catch (error) {
    expect(error).toBeInstanceOf(BadDataException);
    return (error as Error).message;
  }

  throw new Error("Expected the link to be refused.");
}

describe("who may link a pull request to a case", () => {
  const link: SecurityCasePullRequest = new SecurityCasePullRequest();

  test("whoever works the case's response - the Security Member tier and up - links one and takes one off", () => {
    const access: {
      create: Array<Permission>;
      delete: Array<Permission>;
      update: Array<Permission>;
      read: Array<Permission>;
    } = {
      create: link.getCreatePermissions(),
      delete: link.getDeletePermissions(),
      update: link.getUpdatePermissions(),
      read: link.getReadPermissions(),
    };

    for (const permission of [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SecurityAdmin,
      Permission.SecurityMember,
    ]) {
      expect(access.create).toContain(permission);
      expect(access.delete).toContain(permission);
    }

    expect(access.create).toContain(Permission.CreateSecurityCasePullRequest);
    expect(access.delete).toContain(Permission.DeleteSecurityCasePullRequest);
    // A viewer sees the links, and makes none.
    expect(access.create).not.toContain(Permission.SecurityViewer);
    expect(access.delete).not.toContain(Permission.SecurityViewer);
    expect(access.read).toContain(Permission.SecurityViewer);
    expect(access.read).toContain(Permission.ReadSecurityCasePullRequest);
    // Nobody edits a link: what it says of the pull request is OneUptime's.
    expect(access.update).toEqual([]);
  });

  test("a person gives the case and the address; OneUptime writes the rest", () => {
    for (const column of ["securityCaseId", "pullRequestUrl"]) {
      expect(link.getColumnAccessControlFor(column)?.create).toContain(
        Permission.SecurityMember,
      );
    }

    for (const column of [
      "codeRepositoryId",
      "pullRequestNumber",
      "repoOrganizationName",
      "repoName",
      "pullRequestState",
      "mergeCommitSha",
      "mergedAt",
      "deployedAt",
      "deployedVersion",
      "deployedCommitSha",
      "followedAt",
    ]) {
      expect({
        column,
        create: link.getColumnAccessControlFor(column)?.create,
        update: link.getColumnAccessControlFor(column)?.update,
      }).toEqual({ column, create: [], update: [] });
    }
  });
});

describe("a link OneUptime can follow is kept, with what it read of it", () => {
  test("an open pull request on a connected repository: its repository, number and state, its page's own address", async () => {
    const build: CreateBy<SecurityCasePullRequest> = createBy();
    const onCreate: OnCreate<SecurityCasePullRequest> =
      await hooks.onBeforeCreate(build);

    expect(onCreate.createBy.data.projectId?.toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect(onCreate.createBy.data.pullRequestUrl?.toString()).toBe(
      "https://github.com/acme/search/pull/482",
    );
    expect(onCreate.createBy.data.codeRepositoryId?.toString()).toBe(
      REPOSITORY.id!.toString(),
    );
    expect(onCreate.createBy.data.pullRequestNumber).toBe(482);
    expect(onCreate.createBy.data.repoOrganizationName).toBe("acme");
    expect(onCreate.createBy.data.repoName).toBe("search");
    expect(onCreate.createBy.data.pullRequestState).toBe(PullRequestState.Open);
    expect(onCreate.createBy.data.mergeCommitSha).toBeUndefined();
    expect(onCreate.createBy.data.followedAt).toBeInstanceOf(Date);
  });

  test("a merged one, with the commit it merged as and when", async () => {
    const mergedAt: Date = new Date("2026-11-17T19:00:00.000Z");

    read = async (): Promise<CodeHostPullRequestState> => {
      return {
        state: PullRequestState.Merged,
        mergeCommitSha: MERGE_SHA,
        mergedAt,
      };
    };

    const onCreate: OnCreate<SecurityCasePullRequest> =
      await hooks.onBeforeCreate(createBy());

    expect(onCreate.createBy.data.pullRequestState).toBe(
      PullRequestState.Merged,
    );
    expect(onCreate.createBy.data.mergeCommitSha).toBe(MERGE_SHA);
    expect(onCreate.createBy.data.mergedAt).toEqual(mergedAt);
  });

  test("OneUptime's own writes skip the person's read of the repository", async () => {
    readableByPerson = false;

    await hooks.onBeforeCreate(
      createBy(ADDRESS, { isRoot: true, tenantId: PROJECT_ID }),
    );
    expect(CodeRepositoryService.findOneBy).not.toHaveBeenCalled();
  });
});

describe("a link is refused, saying why and what to do", () => {
  test("a case that is not there, or not the project's", async () => {
    caseFound = false;
    expect(await refusal()).toBe(PULL_REQUEST_LINK_CASE_NOT_FOUND);
  });

  test("a case with ten links already", async () => {
    linkedAlready = SECURITY_CASE_PULL_REQUESTS_MAX;
    expect(await refusal()).toBe(PULL_REQUEST_LINK_TOO_MANY);
  });

  test("an address that is not a pull request's page", async () => {
    expect(await refusal(createBy("https://github.com/acme/search"))).toBe(
      PULL_REQUEST_LINK_NOT_AN_ADDRESS,
    );
  });

  test("a repository the project has not connected under Code: named, with where to connect it", async () => {
    repository = null;
    expect(await refusal()).toBe(
      getRefusalText(PULL_REQUEST_LINK_NOT_CONNECTED, {
        repository: "acme/search",
      }),
    );
    expect(await refusal()).toBe(
      "acme/search is not connected to this project. Connect it under Code, so OneUptime can follow its pull requests to their deploy.",
    );
  });

  test("a repository the person may not read in OneUptime", async () => {
    readableByPerson = false;
    expect(await refusal()).toBe(
      getRefusalText(PULL_REQUEST_LINK_REPOSITORY_NOT_READABLE, {
        repository: "acme/search",
      }),
    );
  });

  test("a pull request linked to the case already", async () => {
    duplicates = 1;
    expect(await refusal()).toBe(
      getRefusalText(PULL_REQUEST_LINK_ALREADY_LINKED, {
        pullRequest: "acme/search#482",
      }),
    );
  });

  test("a connection that cannot read pull requests, a pull request the host does not have, and a read that failed", async () => {
    const cases: Array<[LinkedPullRequestReadProblem, string]> = [
      [
        LinkedPullRequestReadProblem.NotFollowed,
        getRefusalText(PULL_REQUEST_LINK_NOT_FOLLOWED, {
          repository: "acme/search",
        }),
      ],
      [
        LinkedPullRequestReadProblem.NotFound,
        getRefusalText(PULL_REQUEST_LINK_NOT_FOUND, {
          pullRequest: "acme/search#482",
        }),
      ],
      [
        LinkedPullRequestReadProblem.ReadFailed,
        getRefusalText(PULL_REQUEST_LINK_READ_FAILED, {
          pullRequest: "acme/search#482",
        }),
      ],
    ];

    for (const [problem, message] of cases) {
      read = async (): Promise<CodeHostPullRequestState> => {
        throw new LinkedPullRequestReadError(problem, "the host said no");
      };

      expect({ problem, message: await refusal() }).toEqual({
        problem,
        message,
      });
    }
  });

  test("a pull request closed without merging is no fix to follow", async () => {
    read = async (): Promise<CodeHostPullRequestState> => {
      return { state: PullRequestState.Closed };
    };

    expect(await refusal()).toBe(
      getRefusalText(PULL_REQUEST_LINK_CLOSED, {
        pullRequest: "acme/search#482",
      }),
    );
  });
});

describe("linked and taken off, on the case's timeline", () => {
  function created(state: PullRequestState): SecurityCasePullRequest {
    const row: SecurityCasePullRequest = new SecurityCasePullRequest();
    row.id = LINK_ID;
    row.projectId = PROJECT_ID;
    row.securityCaseId = CASE_ID;
    row.pullRequestState = state;
    row.createdByUserId = MAYA_ID;
    return row;
  }

  test("linked: said with the pull request one click away, and the case's steps checked at once", async () => {
    const onCreate: OnCreate<SecurityCasePullRequest> =
      await hooks.onBeforeCreate(createBy());

    await hooks.onCreateSuccess(onCreate, created(PullRequestState.Open));

    expect(feedItems).toHaveLength(1);
    expect(feedItems[0]).toMatchObject({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      eventType: SecurityCaseFeedEventType.ResponseAction,
      userId: MAYA_ID,
    });
    expect(String(feedItems[0]!["feedInfoInMarkdown"])).toBe(
      pullRequestLinkedMarkdown({
        name: "acme/search#482",
        url: "https://github.com/acme/search/pull/482",
      }).toString(),
    );
    expect(String(feedItems[0]!["feedInfoInMarkdown"])).toContain(
      "OneUptime follows it to its deploy, then checks the attack is turned away.",
    );
    expect(checksAsked).toEqual([
      { projectId: PROJECT_ID, securityCaseId: CASE_ID },
    ]);
    // Open: nothing to match to a deploy yet.
    expect(followed).toEqual([]);
  });

  test("linked merged: matched to its deploy now, not at the follower's next round", async () => {
    read = async (): Promise<CodeHostPullRequestState> => {
      return { state: PullRequestState.Merged, mergeCommitSha: MERGE_SHA };
    };

    const onCreate: OnCreate<SecurityCasePullRequest> =
      await hooks.onBeforeCreate(createBy());

    await hooks.onCreateSuccess(onCreate, created(PullRequestState.Merged));

    expect(followed).toEqual([{ projectId: PROJECT_ID, id: LINK_ID }]);
  });

  test("taken off: said by name, and the case's steps checked again", async () => {
    const row: SecurityCasePullRequest = created(PullRequestState.Open);
    row.repoOrganizationName = "acme";
    row.repoName = "search";
    row.pullRequestNumber = 482;

    jest
      .spyOn(hooks, "findRowsAndHoldDeleteToThem")
      .mockResolvedValue([row] as never);

    const onDelete: OnDelete<SecurityCasePullRequest> =
      await hooks.onBeforeDelete({
        query: { _id: LINK_ID },
        props: MAYA,
      } as unknown as DeleteBy<SecurityCasePullRequest>);

    await hooks.onDeleteSuccess(onDelete, [LINK_ID]);

    expect(
      feedItems.map((item: JSONObject): string => {
        return String(item["feedInfoInMarkdown"]);
      }),
    ).toEqual([
      pullRequestUnlinkedMarkdown({ name: "acme/search#482" }).toString(),
    ]);
    expect(checksAsked).toEqual([
      { projectId: PROJECT_ID, securityCaseId: CASE_ID },
    ]);
  });
});
