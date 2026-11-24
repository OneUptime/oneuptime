import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import DataSecurityIssue from "../../../Models/DatabaseModels/DataSecurityIssue";
import { DataSecurityIssueFeedEventType } from "../../../Models/DatabaseModels/DataSecurityIssueFeed";
import DataSecurityIssuePullRequest from "../../../Models/DatabaseModels/DataSecurityIssuePullRequest";
import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import DataSecurityIssueFeedService from "../../../Server/Services/DataSecurityIssueFeedService";
import DataSecurityIssuePullRequestService from "../../../Server/Services/DataSecurityIssuePullRequestService";
import DataSecurityIssueService from "../../../Server/Services/DataSecurityIssueService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../../../Server/Types/Database/Hooks";
import DataSecurityFixTarget from "../../../Server/Utils/AI/CodeFix/DataSecurityFixTarget";
import { CodeHostPullRequestState } from "../../../Server/Utils/CodeRepository/CodeHost/CodeHostTypes";
import LinkedPullRequestReader, {
  LinkedPullRequestReadError,
  LinkedPullRequestReadProblem,
} from "../../../Server/Utils/CodeRepository/LinkedPullRequests/LinkedPullRequestReader";
import ProjectReferenceCheck from "../../../Server/Utils/Database/ProjectReferenceCheck";
import DataSecurityLinkedFixes, {
  linkedFixMarkdown,
  unlinkedFixMarkdown,
} from "../../../Server/Utils/DataSecurity/DataSecurityLinkedFixes";
import FixProductionCheck from "../../../Types/AI/FixProductionCheck";
import FixProductionStatus from "../../../Types/AI/FixProductionStatus";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import CodeRepositoryType from "../../../Types/CodeRepository/CodeRepositoryType";
import PullRequestState from "../../../Types/CodeRepository/PullRequestState";
import {
  DATA_SECURITY_ISSUE_PULL_REQUESTS_MAX,
  ISSUE_PULL_REQUEST_ALREADY_LINKED,
  ISSUE_PULL_REQUEST_ISSUE_NOT_FOUND,
  ISSUE_PULL_REQUEST_SET_ASIDE,
  ISSUE_PULL_REQUEST_TOO_MANY,
  PULL_REQUEST_LINK_CLOSED,
  PULL_REQUEST_LINK_NOT_AN_ADDRESS,
  PULL_REQUEST_LINK_NOT_CONNECTED,
  PULL_REQUEST_LINK_NOT_FOLLOWED,
  PULL_REQUEST_LINK_NOT_FOUND,
  PULL_REQUEST_LINK_READ_FAILED,
  PULL_REQUEST_LINK_REPOSITORY_NOT_READABLE,
  canIssueTakePullRequest,
} from "../../../Types/DataSecurity/DataSecurityIssuePullRequestLink";
import DataSecurityIssueStatus from "../../../Types/DataSecurity/DataSecurityIssueStatus";
import BadDataException from "../../../Types/Exception/BadDataException";
import { getRefusalText } from "../../../Types/Exception/RefusalWithValues";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";

/*
 * A person's own pull request, linked to a Data Security issue as its fix
 * (#10831). Who may link one - who may change the issue, and only with read
 * access to its repository in OneUptime - and what a link is refused for,
 * each with a reason the person can act on: an issue that is not there or
 * set aside, too many links, no pull request's address, a repository the
 * project has not connected under Code or the person may not read there,
 * one linked already, a connection that cannot read pull requests, a pull
 * request the host does not have or closed unmerged. What OneUptime read
 * of it - and the production check its issue's store calls for - is
 * written by OneUptime, and linking or taking one off is on the issue's
 * timeline.
 *
 * No database: the services' reads and writes are spied, the hooks are
 * called as DatabaseService calls them.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5a5a5a5a-1111-4111-8111-111111111111",
);
const ISSUE_ID: ObjectID = new ObjectID("5a5a5a5a-2222-4222-8222-222222222222");
const LINK_ID: ObjectID = new ObjectID("5a5a5a5a-3333-4333-8333-333333333333");
const STORE_ID: ObjectID = new ObjectID("5a5a5a5a-5555-4555-8555-555555555555");
const MAYA_ID: ObjectID = new ObjectID("5a5a5a5a-aaaa-4aaa-8aaa-000000000001");
const MERGE_SHA: string = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b";
const ADDRESS: string = "https://github.com/acme/checkout/pull/482/files";

type Hooks = {
  onBeforeCreate: (
    createBy: CreateBy<DataSecurityIssuePullRequest>,
  ) => Promise<OnCreate<DataSecurityIssuePullRequest>>;
  onCreateSuccess: (
    onCreate: OnCreate<DataSecurityIssuePullRequest>,
    createdItem: DataSecurityIssuePullRequest,
  ) => Promise<DataSecurityIssuePullRequest>;
  onBeforeDelete: (
    deleteBy: DeleteBy<DataSecurityIssuePullRequest>,
  ) => Promise<OnDelete<DataSecurityIssuePullRequest>>;
  onDeleteSuccess: (
    onDelete: OnDelete<DataSecurityIssuePullRequest>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ) => Promise<OnDelete<DataSecurityIssuePullRequest>>;
  findRowsAndHoldDeleteToThem: (...args: Array<unknown>) => Promise<unknown>;
};

const hooks: Hooks = DataSecurityIssuePullRequestService as unknown as Hooks;

// Maya, who may change the issue.
const MAYA: DatabaseCommonInteractionProps = {
  userId: MAYA_ID,
  tenantId: PROJECT_ID,
};

const REPOSITORY: CodeRepository = ((): CodeRepository => {
  const row: CodeRepository = new CodeRepository();
  row.id = new ObjectID("5a5a5a5a-4444-4444-8444-444444444444");
  row.projectId = PROJECT_ID;
  row.repositoryHostedAt = CodeRepositoryType.GitHub;
  row.organizationName = "acme";
  row.repositoryName = "checkout";
  return row;
})();

let feedItems: Array<JSONObject>;
let started: Array<JSONObject>;
let linkedAlready: number;
let duplicates: number;
let repository: CodeRepository | null;
let readableByPerson: boolean;
let issueReadableByPerson: boolean;
let issue: DataSecurityIssue | null;
let check: FixProductionCheck;
let read: () => Promise<CodeHostPullRequestState>;

beforeEach(() => {
  feedItems = [];
  started = [];
  linkedAlready = 0;
  duplicates = 0;
  repository = REPOSITORY;
  readableByPerson = true;
  issueReadableByPerson = true;
  check = FixProductionCheck.TelemetryLeak;
  issue = Object.assign(new DataSecurityIssue(ISSUE_ID), {
    status: DataSecurityIssueStatus.Open,
    dataStoreId: STORE_ID,
  });
  read = async (): Promise<CodeHostPullRequestState> => {
    return { state: PullRequestState.Open };
  };

  jest
    .spyOn(ProjectReferenceCheck, "validateCreate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(DataSecurityIssueService, "findOneBy")
    .mockImplementation(async (args: unknown) => {
      const props: DatabaseCommonInteractionProps = (
        args as { props: DatabaseCommonInteractionProps }
      ).props;

      // The person's own read, held to what they may read.
      if (!props.isRoot) {
        return issueReadableByPerson ? (issue as never) : null;
      }

      return issue as never;
    });
  jest
    .spyOn(DataSecurityIssuePullRequestService, "countBy")
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
    .spyOn(DataSecurityFixTarget, "checkOfStore")
    .mockImplementation(async (): Promise<FixProductionCheck> => {
      return check;
    });
  jest
    .spyOn(DataSecurityIssueFeedService, "createDataSecurityIssueFeedItem")
    .mockImplementation(async (args: unknown) => {
      feedItems.push(args as JSONObject);
      return undefined as never;
    });
  jest
    .spyOn(DataSecurityLinkedFixes, "startFollowing")
    .mockImplementation(async (args: unknown): Promise<void> => {
      started.push(args as JSONObject);
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function createBy(
  address: string = ADDRESS,
  props: DatabaseCommonInteractionProps = MAYA,
): CreateBy<DataSecurityIssuePullRequest> {
  const data: DataSecurityIssuePullRequest = new DataSecurityIssuePullRequest();
  data.dataSecurityIssueId = ISSUE_ID;
  data.pullRequestUrl = URL.fromString(address);

  return { data, props };
}

async function refusal(
  build: CreateBy<DataSecurityIssuePullRequest> = createBy(),
): Promise<string> {
  try {
    await hooks.onBeforeCreate(build);
  } catch (error) {
    expect(error).toBeInstanceOf(BadDataException);
    return (error as Error).message;
  }

  throw new Error("Expected the link to be refused.");
}

describe("who may link a pull request to an issue", () => {
  const link: DataSecurityIssuePullRequest = new DataSecurityIssuePullRequest();
  const issueModel: DataSecurityIssue = new DataSecurityIssue();

  test("whoever may change the issue links one and takes one off; whoever may read it sees them", () => {
    expect([...link.getCreatePermissions()].sort()).toEqual(
      [...issueModel.getUpdatePermissions()].sort(),
    );
    expect([...link.getDeletePermissions()].sort()).toEqual(
      [...issueModel.getUpdatePermissions()].sort(),
    );
    expect([...link.getReadPermissions()].sort()).toEqual(
      [...issueModel.getReadPermissions()].sort(),
    );

    for (const permission of [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SecurityAdmin,
      Permission.SecurityMember,
      Permission.EditDataSecurityIssue,
    ]) {
      expect(link.getCreatePermissions()).toContain(permission);
    }

    // A viewer sees the links, and makes none.
    expect(link.getCreatePermissions()).not.toContain(
      Permission.SecurityViewer,
    );
    expect(link.getDeletePermissions()).not.toContain(
      Permission.SecurityViewer,
    );
    expect(link.getReadPermissions()).toContain(Permission.SecurityViewer);
    // Nobody edits a link: what it says of the pull request is OneUptime's.
    expect(link.getUpdatePermissions()).toEqual([]);
  });

  test("a person gives the issue and the address; OneUptime writes the rest, and keeps its baseline to itself", () => {
    for (const column of ["dataSecurityIssueId", "pullRequestUrl"]) {
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
      "followedAt",
      "productionCheck",
      "productionStatus",
      "productionStatusAt",
      "productionSummary",
      "deployedAt",
      "deployedVersion",
      "deployedCommitSha",
    ]) {
      expect({
        column,
        create: link.getColumnAccessControlFor(column)?.create,
        update: link.getColumnAccessControlFor(column)?.update,
      }).toEqual({ column, create: [], update: [] });
      expect(link.getColumnAccessControlFor(column)?.read).toContain(
        Permission.SecurityViewer,
      );
    }

    // What the check measured names attribute keys: read through no route.
    expect(link.getColumnAccessControlFor("productionBaseline")).toMatchObject({
      create: [],
      read: [],
      update: [],
    });
  });

  test("an open or a resolved issue takes one; one set aside does not", () => {
    expect(canIssueTakePullRequest(DataSecurityIssueStatus.Open)).toBe(true);
    expect(canIssueTakePullRequest(DataSecurityIssueStatus.Resolved)).toBe(
      true,
    );
    expect(canIssueTakePullRequest(DataSecurityIssueStatus.Accepted)).toBe(
      false,
    );
    expect(canIssueTakePullRequest(DataSecurityIssueStatus.NotAnIssue)).toBe(
      false,
    );
    expect(canIssueTakePullRequest(undefined)).toBe(false);
  });
});

describe("a link OneUptime can follow is kept, with what it read of it", () => {
  test("an open pull request on a connected repository: its repository, number and state, its page's own address, and the leak's check", async () => {
    const onCreate: OnCreate<DataSecurityIssuePullRequest> =
      await hooks.onBeforeCreate(createBy());
    const data: DataSecurityIssuePullRequest = onCreate.createBy.data;

    expect(data.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(data.dataSecurityIssueId?.toString()).toBe(ISSUE_ID.toString());
    expect(data.pullRequestUrl?.toString()).toBe(
      "https://github.com/acme/checkout/pull/482",
    );
    expect(data.codeRepositoryId?.toString()).toBe(REPOSITORY.id!.toString());
    expect(data.pullRequestNumber).toBe(482);
    expect(data.repoOrganizationName).toBe("acme");
    expect(data.repoName).toBe("checkout");
    expect(data.pullRequestState).toBe(PullRequestState.Open);
    expect(data.followedAt).toBeInstanceOf(Date);
    // Picked from the issue's store, as an AI fix's is when it merges.
    expect(data.productionCheck).toBe(FixProductionCheck.TelemetryLeak);
    // Not merged: nothing waits for a deploy yet.
    expect(data.productionStatus).toBeUndefined();
    expect(data.mergeCommitSha).toBeUndefined();
  });

  test("a store's issue is followed as its configuration", async () => {
    check = FixProductionCheck.StoreConfiguration;

    const onCreate: OnCreate<DataSecurityIssuePullRequest> =
      await hooks.onBeforeCreate(createBy());

    expect(onCreate.createBy.data.productionCheck).toBe(
      FixProductionCheck.StoreConfiguration,
    );
  });

  test("a merged one: its merge commit and moment, and its check waiting for the deploy that ships it", async () => {
    const mergedAt: Date = new Date("2026-11-17T19:00:00.000Z");

    read = async (): Promise<CodeHostPullRequestState> => {
      return {
        state: PullRequestState.Merged,
        mergeCommitSha: MERGE_SHA,
        mergedAt,
      };
    };

    const onCreate: OnCreate<DataSecurityIssuePullRequest> =
      await hooks.onBeforeCreate(createBy());
    const data: DataSecurityIssuePullRequest = onCreate.createBy.data;

    expect(data.pullRequestState).toBe(PullRequestState.Merged);
    expect(data.mergeCommitSha).toBe(MERGE_SHA);
    expect(data.mergedAt).toEqual(mergedAt);
    expect(data.productionStatus).toBe(FixProductionStatus.AwaitingDeploy);
    expect(data.productionStatusAt).toBeInstanceOf(Date);
    expect(data.productionSummary).toBe(
      "Merged. Waiting for a recorded deploy of the service that contains the fix.",
    );
  });

  test("an address pasted without its scheme, or on a resolved issue, is linked all the same", async () => {
    issue = Object.assign(new DataSecurityIssue(ISSUE_ID), {
      status: DataSecurityIssueStatus.Resolved,
      dataStoreId: STORE_ID,
    });

    const onCreate: OnCreate<DataSecurityIssuePullRequest> =
      await hooks.onBeforeCreate(
        createBy("https://github.com/acme/checkout/pull/482?tab=files"),
      );

    expect(onCreate.createBy.data.pullRequestUrl?.toString()).toBe(
      "https://github.com/acme/checkout/pull/482",
    );
  });

  test("OneUptime itself links one without the person's own reads", async () => {
    readableByPerson = false;
    issueReadableByPerson = false;

    const onCreate: OnCreate<DataSecurityIssuePullRequest> =
      await hooks.onBeforeCreate(
        createBy(ADDRESS, { isRoot: true, tenantId: PROJECT_ID }),
      );

    expect(onCreate.createBy.data.pullRequestNumber).toBe(482);
  });
});

describe("a link OneUptime could not follow is refused, saying why", () => {
  test("an issue that is not there, or that the person may not read (held from them by its labels)", async () => {
    issue = null;
    expect(await refusal()).toBe(ISSUE_PULL_REQUEST_ISSUE_NOT_FOUND);

    issue = Object.assign(new DataSecurityIssue(ISSUE_ID), {
      status: DataSecurityIssueStatus.Open,
      dataStoreId: STORE_ID,
    });
    issueReadableByPerson = false;
    expect(await refusal()).toBe(ISSUE_PULL_REQUEST_ISSUE_NOT_FOUND);
  });

  test("no issue named at all", async () => {
    const build: CreateBy<DataSecurityIssuePullRequest> = createBy();
    delete (build.data as unknown as JSONObject)["dataSecurityIssueId"];

    expect(await refusal(build)).toBe(ISSUE_PULL_REQUEST_ISSUE_NOT_FOUND);
  });

  test("an issue set aside - its risk accepted, or not an issue - watches nothing", async () => {
    for (const status of [
      DataSecurityIssueStatus.Accepted,
      DataSecurityIssueStatus.NotAnIssue,
    ]) {
      issue = Object.assign(new DataSecurityIssue(ISSUE_ID), {
        status,
        dataStoreId: STORE_ID,
      });
      expect(await refusal()).toBe(ISSUE_PULL_REQUEST_SET_ASIDE);
    }
  });

  test(`ten links on an issue already`, async () => {
    linkedAlready = DATA_SECURITY_ISSUE_PULL_REQUESTS_MAX;
    expect(await refusal()).toBe(ISSUE_PULL_REQUEST_TOO_MANY);
  });

  test("an address that is no pull request's", async () => {
    for (const address of [
      "https://github.com/acme/checkout",
      "https://github.com/acme/checkout/issues/482",
      "https://gitlab.com/acme/checkout/-/issues/482",
    ]) {
      expect(await refusal(createBy(address))).toBe(
        PULL_REQUEST_LINK_NOT_AN_ADDRESS,
      );
    }
  });

  test("a repository the project has not connected under Code", async () => {
    repository = null;
    expect(await refusal()).toBe(
      getRefusalText(PULL_REQUEST_LINK_NOT_CONNECTED, {
        repository: "acme/checkout",
      }),
    );
  });

  test("a repository the person may not read in OneUptime", async () => {
    readableByPerson = false;
    expect(await refusal()).toBe(
      getRefusalText(PULL_REQUEST_LINK_REPOSITORY_NOT_READABLE, {
        repository: "acme/checkout",
      }),
    );
  });

  test("the same pull request on this issue already", async () => {
    duplicates = 1;
    expect(await refusal()).toBe(
      getRefusalText(ISSUE_PULL_REQUEST_ALREADY_LINKED, {
        pullRequest: "acme/checkout#482",
      }),
    );
  });

  test("a connection that cannot read pull requests, a pull request the host does not have, a read that failed", async () => {
    read = async (): Promise<CodeHostPullRequestState> => {
      throw new LinkedPullRequestReadError(
        LinkedPullRequestReadProblem.NotFollowed,
        "no pull requests",
      );
    };
    expect(await refusal()).toBe(
      getRefusalText(PULL_REQUEST_LINK_NOT_FOLLOWED, {
        repository: "acme/checkout",
      }),
    );

    read = async (): Promise<CodeHostPullRequestState> => {
      throw new LinkedPullRequestReadError(
        LinkedPullRequestReadProblem.NotFound,
        "404",
      );
    };
    expect(await refusal()).toBe(
      getRefusalText(PULL_REQUEST_LINK_NOT_FOUND, {
        pullRequest: "acme/checkout#482",
      }),
    );

    read = async (): Promise<CodeHostPullRequestState> => {
      throw new Error("socket hang up");
    };
    expect(await refusal()).toBe(
      getRefusalText(PULL_REQUEST_LINK_READ_FAILED, {
        pullRequest: "acme/checkout#482",
      }),
    );
  });

  test("a pull request closed without merging is no fix to follow", async () => {
    read = async (): Promise<CodeHostPullRequestState> => {
      return { state: PullRequestState.Closed };
    };
    expect(await refusal()).toBe(
      getRefusalText(PULL_REQUEST_LINK_CLOSED, {
        pullRequest: "acme/checkout#482",
      }),
    );
  });
});

describe("linked and taken off, on the issue's timeline", () => {
  function linkRow(
    overrides: Partial<DataSecurityIssuePullRequest> = {},
  ): DataSecurityIssuePullRequest {
    return Object.assign(new DataSecurityIssuePullRequest(LINK_ID), {
      projectId: PROJECT_ID,
      dataSecurityIssueId: ISSUE_ID,
      pullRequestUrl: URL.fromString(
        "https://github.com/acme/checkout/pull/482",
      ),
      pullRequestNumber: 482,
      repoOrganizationName: "acme",
      repoName: "checkout",
      pullRequestState: PullRequestState.Open,
      productionCheck: FixProductionCheck.TelemetryLeak,
      createdByUserId: MAYA_ID,
      ...overrides,
    });
  }

  test("linked: the issue says who linked which pull request, and OneUptime starts following it", async () => {
    const created: DataSecurityIssuePullRequest = linkRow();

    await hooks.onCreateSuccess(
      { createBy: createBy(), carryForward: {} },
      created,
    );

    expect(feedItems).toHaveLength(1);
    expect(feedItems[0]).toMatchObject({
      projectId: PROJECT_ID,
      dataSecurityIssueId: ISSUE_ID,
      eventType: DataSecurityIssueFeedEventType.FixLinked,
      userId: MAYA_ID,
      feedInfoInMarkdown: linkedFixMarkdown({
        name: "acme/checkout#482",
        url: "https://github.com/acme/checkout/pull/482",
        check: FixProductionCheck.TelemetryLeak,
      }).toString(),
    });
    expect(String(feedItems[0]!["feedInfoInMarkdown"])).toContain(
      "[acme/checkout#482](https://github.com/acme/checkout/pull/482)",
    );
    expect(started).toEqual([{ projectId: PROJECT_ID, id: LINK_ID }]);
  });

  test("a store's fix is said as one applied, not shipped", () => {
    expect(
      linkedFixMarkdown({
        name: "acme/infra#57",
        url: "https://github.com/acme/infra/pull/57",
        check: FixProductionCheck.StoreConfiguration,
      }).toString(),
    ).toContain("fixed in infrastructure code when the store passes its check");
    expect(
      linkedFixMarkdown({
        name: "acme/checkout#482",
        url: "https://github.com/acme/checkout/pull/482",
        check: FixProductionCheck.TelemetryLeak,
      }).toString(),
    ).toContain("fixed in code when the new version no longer writes the data");
  });

  test("a timeline line that fails never undoes the link, and following starts all the same", async () => {
    jest
      .spyOn(DataSecurityIssueFeedService, "createDataSecurityIssueFeedItem")
      .mockRejectedValue(new Error("feed down"));

    const created: DataSecurityIssuePullRequest = linkRow();

    expect(
      await hooks.onCreateSuccess(
        { createBy: createBy(), carryForward: {} },
        created,
      ),
    ).toBe(created);
    expect(started).toHaveLength(1);
  });

  test("taken off: the issue says who took which off", async () => {
    const row: DataSecurityIssuePullRequest = linkRow();

    jest
      .spyOn(DataSecurityIssuePullRequestService, "findRowsAndHoldDeleteToThem")
      .mockResolvedValue([row] as never);

    const deleteBy: DeleteBy<DataSecurityIssuePullRequest> = {
      query: { _id: LINK_ID },
      props: MAYA,
    } as DeleteBy<DataSecurityIssuePullRequest>;
    const onDelete: OnDelete<DataSecurityIssuePullRequest> =
      await hooks.onBeforeDelete(deleteBy);

    await hooks.onDeleteSuccess(onDelete, [LINK_ID]);

    expect(feedItems).toEqual([
      expect.objectContaining({
        dataSecurityIssueId: ISSUE_ID,
        eventType: DataSecurityIssueFeedEventType.FixUnlinked,
        userId: MAYA_ID,
        feedInfoInMarkdown: unlinkedFixMarkdown({
          name: "acme/checkout#482",
        }).toString(),
      }),
    ]);
  });
});
