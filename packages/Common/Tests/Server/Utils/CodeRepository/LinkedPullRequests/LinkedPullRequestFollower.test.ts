import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { SpyInstance } from "jest-mock";
import CodeRepository from "../../../../../Models/DatabaseModels/CodeRepository";
import FixProductionVerifier, {
  FixDeploy,
  VerifierRun,
} from "../../../../../Server/Utils/AI/CodeFix/FixProductionVerifier";
import { CodeHostPullRequestState } from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostTypes";
import LinkedPullRequestFollower, {
  FollowedLink,
  LinkedPullRequestKind,
  PullRequestFollowed,
} from "../../../../../Server/Utils/CodeRepository/LinkedPullRequests/LinkedPullRequestFollower";
import LinkedPullRequestReader, {
  LinkedPullRequestReadError,
  LinkedPullRequestReadProblem,
} from "../../../../../Server/Utils/CodeRepository/LinkedPullRequests/LinkedPullRequestReader";
import logger from "../../../../../Server/Utils/Logger";
import CodeRepositoryType from "../../../../../Types/CodeRepository/CodeRepositoryType";
import PullRequestState from "../../../../../Types/CodeRepository/PullRequestState";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";

/*
 * THE ONE FOLLOWER OF A PULL REQUEST A PERSON LINKED (#10604, #10831),
 * whatever it is linked to: a kind of link says where its rows are kept,
 * whether it finds its own deploy, what a merge writes beside its state,
 * and what it does once something changed. These pin the loop every kind
 * shares, with a kind made up for the test.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "7c7c7c7c-0000-4000-8000-000000000001",
);
const NOW: Date = new Date("2026-11-21T10:00:00.000Z");
const MERGED_AT: Date = new Date("2026-11-21T09:30:00.000Z");
const MERGE_SHA: string = "abcdef0123456789abcdef0123456789abcdef01";

interface TestLink extends FollowedLink {
  label: string;
}

function link(overrides: Partial<TestLink> = {}): TestLink {
  const repository: CodeRepository = new CodeRepository();
  repository.id = new ObjectID("7c7c7c7c-0000-4000-8000-000000000002");
  repository.repositoryHostedAt = CodeRepositoryType.GitHub;
  repository.organizationName = "acme";
  repository.repositoryName = "checkout";

  return {
    id: new ObjectID("7c7c7c7c-0000-4000-8000-000000000003"),
    projectId: PROJECT_ID,
    pullRequestState: PullRequestState.Open,
    pullRequestNumber: 482,
    codeRepository: repository,
    repoOrganizationName: "acme",
    repoName: "checkout",
    label: "the test's link",
    ...overrides,
  };
}

let writes: Array<{ update: JSONObject; isChanged: boolean }>;
let shipped: Array<FixDeploy>;
let changes: Array<{ row: TestLink; followed: PullRequestFollowed }>;
let hostSays: () => Promise<CodeHostPullRequestState>;
let deploy: FixDeploy | null;

function kind(
  overrides: Partial<LinkedPullRequestKind<TestLink>> = {},
): LinkedPullRequestKind<TestLink> {
  return {
    name: "test link",
    findsDeploy: false,
    readToFollow: async (): Promise<Array<TestLink>> => {
      return [link()];
    },
    write: async (data: {
      row: TestLink;
      update: JSONObject;
      isChanged: boolean;
    }): Promise<void> => {
      writes.push({ update: { ...data.update }, isChanged: data.isChanged });
    },
    onShipped: async (data: { deploy: FixDeploy }): Promise<void> => {
      shipped.push(data.deploy);
    },
    afterChange: async (data: {
      row: TestLink;
      followed: PullRequestFollowed;
    }): Promise<void> => {
      changes.push({ row: { ...data.row }, followed: { ...data.followed } });
    },
    ...overrides,
  };
}

function run(): VerifierRun {
  return LinkedPullRequestFollower.newRun(NOW);
}

beforeEach(() => {
  writes = [];
  shipped = [];
  changes = [];
  deploy = null;
  hostSays = async (): Promise<CodeHostPullRequestState> => {
    return { state: PullRequestState.Open };
  };

  jest
    .spyOn(LinkedPullRequestReader, "readState")
    .mockImplementation(async (): Promise<CodeHostPullRequestState> => {
      return await hostSays();
    });
  jest
    .spyOn(FixProductionVerifier, "findDeployContainingFix")
    .mockImplementation(async (): Promise<FixDeploy | null> => {
      return deploy;
    });
  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
  jest.spyOn(logger, "debug").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("one link, followed", () => {
  test("still open: only when it was followed is written, as nothing changed, and its kind is told nothing", async () => {
    expect(
      await LinkedPullRequestFollower.followOne({
        kind: kind(),
        row: link(),
        run: run(),
      }),
    ).toEqual({ isChanged: false, isShipped: false });
    expect(writes).toEqual([{ update: { followedAt: NOW }, isChanged: false }]);
    expect(changes).toEqual([]);
  });

  test("merged: its state, commit and moment, what its kind writes on a merge, and its kind told after the write", async () => {
    hostSays = async (): Promise<CodeHostPullRequestState> => {
      return {
        state: PullRequestState.Merged,
        mergeCommitSha: MERGE_SHA,
        mergedAt: MERGED_AT,
      };
    };

    const followed: PullRequestFollowed =
      await LinkedPullRequestFollower.followOne({
        kind: kind({
          fieldsWhenMerged: (): JSONObject => {
            return { productionStatus: "AwaitingDeploy" };
          },
        }),
        row: link(),
        run: run(),
      });

    expect(followed).toEqual({
      isChanged: true,
      isShipped: false,
      isMerged: true,
      isClosed: false,
    });
    expect(writes).toEqual([
      {
        update: {
          followedAt: NOW,
          pullRequestState: PullRequestState.Merged,
          mergedAt: MERGED_AT,
          mergeCommitSha: MERGE_SHA,
          productionStatus: "AwaitingDeploy",
        },
        isChanged: true,
      },
    ]);
    // Told with the row as it was written.
    expect(changes[0]!.row).toMatchObject({
      pullRequestState: PullRequestState.Merged,
      mergeCommitSha: MERGE_SHA,
      productionStatus: "AwaitingDeploy",
    });
  });

  test("merged with no moment the host said: the follower's own time", async () => {
    hostSays = async (): Promise<CodeHostPullRequestState> => {
      return { state: PullRequestState.Merged };
    };

    await LinkedPullRequestFollower.followOne({
      kind: kind(),
      row: link(),
      run: run(),
    });

    expect(writes[0]!.update["mergedAt"]).toEqual(NOW);
    expect(writes[0]!.update).not.toHaveProperty("mergeCommitSha");
  });

  test("closed without merging: written, and its kind told it closed", async () => {
    hostSays = async (): Promise<CodeHostPullRequestState> => {
      return { state: PullRequestState.Closed };
    };

    await LinkedPullRequestFollower.followOne({
      kind: kind(),
      row: link(),
      run: run(),
    });

    expect(writes[0]).toEqual({
      update: { followedAt: NOW, pullRequestState: PullRequestState.Closed },
      isChanged: true,
    });
    expect(changes[0]!.followed).toMatchObject({
      isClosed: true,
      isMerged: false,
    });
  });

  test("a kind that finds its deploy: a merged link matched to the deploy that shipped it, said at once", async () => {
    deploy = {
      changeId: "change-1",
      time: new Date("2026-11-21T09:50:00.000Z"),
      version: "2.4.1",
      commitSha: MERGE_SHA,
    };

    const followed: PullRequestFollowed =
      await LinkedPullRequestFollower.followOne({
        kind: kind({ findsDeploy: true }),
        row: link({
          pullRequestState: PullRequestState.Merged,
          mergeCommitSha: MERGE_SHA,
          mergedAt: MERGED_AT,
        }),
        run: run(),
      });

    expect(followed).toEqual({ isChanged: true, isShipped: true });
    expect(shipped).toEqual([deploy]);
    expect(writes[0]!.update).toMatchObject({
      deployedAt: deploy.time,
      deployedVersion: "2.4.1",
      deployedCommitSha: MERGE_SHA,
    });
  });

  test("a kind whose deploy its check finds is never matched to one here", async () => {
    deploy = {
      changeId: "change-1",
      time: NOW,
      commitSha: MERGE_SHA,
    };
    const deploys: SpyInstance<
      typeof FixProductionVerifier.findDeployContainingFix
    > = jest.spyOn(FixProductionVerifier, "findDeployContainingFix");

    await LinkedPullRequestFollower.followOne({
      kind: kind({ findsDeploy: false }),
      row: link({
        pullRequestState: PullRequestState.Merged,
        mergeCommitSha: MERGE_SHA,
        mergedAt: MERGED_AT,
      }),
      run: run(),
    });

    expect(deploys).not.toHaveBeenCalled();
    expect(writes).toEqual([{ update: { followedAt: NOW }, isChanged: false }]);
  });

  test("a host that does not answer: followed again next time, and never thrown", async () => {
    hostSays = async (): Promise<CodeHostPullRequestState> => {
      throw new LinkedPullRequestReadError(
        LinkedPullRequestReadProblem.ReadFailed,
        "502",
      );
    };

    expect(
      await LinkedPullRequestFollower.followOne({
        kind: kind(),
        row: link(),
        run: run(),
      }),
    ).toEqual({ isChanged: false, isShipped: false });
    expect(writes).toEqual([{ update: { followedAt: NOW }, isChanged: false }]);
  });

  test("a write that fails is logged, never thrown, and its kind is not told", async () => {
    hostSays = async (): Promise<CodeHostPullRequestState> => {
      return { state: PullRequestState.Closed };
    };

    await expect(
      LinkedPullRequestFollower.followOne({
        kind: kind({
          write: async (): Promise<void> => {
            throw new Error("database gone");
          },
        }),
        row: link(),
        run: run(),
      }),
    ).resolves.toMatchObject({ isChanged: true });
    expect(changes).toEqual([]);
    expect(logger.error).toHaveBeenCalled();
  });

  test("a row with no id or project is left alone", async () => {
    expect(
      await LinkedPullRequestFollower.followOne({
        kind: kind(),
        row: link({ projectId: undefined }),
        run: run(),
      }),
    ).toEqual({ isChanged: false, isShipped: false });
    expect(writes).toEqual([]);
  });
});

describe("every link of a kind", () => {
  test("each read and followed on its own, in the order its kind gives", async () => {
    const first: TestLink = link({
      id: new ObjectID("7c7c7c7c-0000-4000-8000-0000000000a1"),
    });
    const second: TestLink = link({
      id: new ObjectID("7c7c7c7c-0000-4000-8000-0000000000a2"),
    });
    let calls: number = 0;

    hostSays = async (): Promise<CodeHostPullRequestState> => {
      calls++;

      if (calls === 1) {
        throw new Error("one host down");
      }

      return { state: PullRequestState.Closed };
    };

    expect(
      await LinkedPullRequestFollower.followAll({
        kind: kind({
          readToFollow: async (): Promise<Array<TestLink>> => {
            return [first, second];
          },
        }),
        now: NOW,
      }),
    ).toBe(2);
    // The first host's failure never stopped the second.
    expect(
      writes.map((write: { isChanged: boolean }) => {
        return write.isChanged;
      }),
    ).toEqual([false, true]);
  });

  test("links that cannot be read at all: none followed, and nothing thrown", async () => {
    expect(
      await LinkedPullRequestFollower.followAll({
        kind: kind({
          readToFollow: async (): Promise<Array<TestLink>> => {
            throw new Error("table locked");
          },
        }),
        now: NOW,
      }),
    ).toBe(0);
    expect(writes).toEqual([]);
    expect(logger.error).toHaveBeenCalled();
  });

  test("a run reads its tokens and compares once, from a moment of its own", () => {
    const fresh: VerifierRun = LinkedPullRequestFollower.newRun(NOW);

    expect(fresh.now).toBe(NOW);
    expect(fresh.tokens.size).toBe(0);
    expect(fresh.failedCompares.size).toBe(0);
  });
});
