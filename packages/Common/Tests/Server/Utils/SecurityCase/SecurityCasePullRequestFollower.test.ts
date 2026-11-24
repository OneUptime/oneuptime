import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import { SecurityCaseFeedEventType } from "../../../../Models/DatabaseModels/SecurityCaseFeed";
import SecurityCasePullRequest from "../../../../Models/DatabaseModels/SecurityCasePullRequest";
import SecurityCaseFeedService from "../../../../Server/Services/SecurityCaseFeedService";
import SecurityCasePullRequestService from "../../../../Server/Services/SecurityCasePullRequestService";
import FixProductionVerifier, {
  FixDeploy,
} from "../../../../Server/Utils/AI/CodeFix/FixProductionVerifier";
import { CodeHostPullRequestState } from "../../../../Server/Utils/CodeRepository/CodeHost/CodeHostTypes";
import LinkedPullRequestReader, {
  LinkedPullRequestReadError,
  LinkedPullRequestReadProblem,
} from "../../../../Server/Utils/CodeRepository/LinkedPullRequests/LinkedPullRequestReader";
import SecurityCasePullRequestFollower, {
  PullRequestFollowed,
  SECURITY_CASE_PULL_REQUEST_FOLLOW_BATCH,
} from "../../../../Server/Utils/SecurityCase/SecurityCasePullRequestFollower";
import {
  FixPullRequest,
  readLinkedPullRequest,
} from "../../../../Server/Utils/SecurityCase/StepChecks/Evidence/FixChanges";
import SecurityCaseStepChecks from "../../../../Server/Utils/SecurityCase/StepChecks/SecurityCaseStepChecks";
import URL from "../../../../Types/API/URL";
import GreaterThan from "../../../../Types/BaseDatabase/GreaterThan";
import IsNull from "../../../../Types/BaseDatabase/IsNull";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import CodeRepositoryType from "../../../../Types/CodeRepository/CodeRepositoryType";
import PullRequestState from "../../../../Types/CodeRepository/PullRequestState";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { pullRequestShippedMarkdown } from "../../../../Utils/SecurityCase/SecurityCaseMarkdown";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { SpyInstance } from "jest-mock";

/*
 * Following a pull request a person linked to a security case (#10604) the
 * way OneUptime follows its own: its state read while it is open, then the
 * deploy that carried its merge commit, written on its row - which the Fix
 * step's check reads with Fix With AI's (FixChanges) - and said on the
 * case's timeline, with the case's steps checked at once. A host that does
 * not answer is read again next time; nothing here throws.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CASE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const MERGE_SHA: string = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b";
const DEPLOY_SHA: string = "9f8e7d6c5b4a39281706f5e4d3c2b1a098765432";
const NOW: Date = new Date("2026-11-18T12:00:00.000Z");
const MERGED_AT: Date = new Date("2026-11-18T09:40:00.000Z");
const DEPLOYED_AT: Date = new Date("2026-11-18T10:05:00.000Z");
const URL_OF_IT: string = "https://github.com/acme/search/pull/482";

function linkRow(
  overrides: Partial<SecurityCasePullRequest> = {},
): SecurityCasePullRequest {
  const row: SecurityCasePullRequest = new SecurityCasePullRequest();
  row.id = new ObjectID("33333333-3333-4333-8333-333333333333");
  row.projectId = PROJECT_ID;
  row.securityCaseId = CASE_ID;
  row.pullRequestUrl = URL.fromString(URL_OF_IT);
  row.pullRequestNumber = 482;
  row.repoOrganizationName = "acme";
  row.repoName = "search";
  row.pullRequestState = PullRequestState.Open;
  row.codeRepository = new CodeRepository();
  row.codeRepository.id = new ObjectID("44444444-4444-4444-8444-444444444444");
  row.codeRepository.repositoryHostedAt = CodeRepositoryType.GitHub;
  row.codeRepository.organizationName = "acme";
  row.codeRepository.repositoryName = "search";
  Object.assign(row, overrides);
  return row;
}

let writes: Array<JSONObject>;
let feedItems: Array<JSONObject>;
let checksAsked: Array<JSONObject>;
let read: (row: number) => Promise<CodeHostPullRequestState>;
let deploy: FixDeploy | null;

beforeEach(() => {
  writes = [];
  feedItems = [];
  checksAsked = [];
  deploy = null;
  read = async (): Promise<CodeHostPullRequestState> => {
    return { state: PullRequestState.Open };
  };

  jest
    .spyOn(LinkedPullRequestReader, "readState")
    .mockImplementation(
      async (asked: unknown): Promise<CodeHostPullRequestState> => {
        return await read((asked as { number: number }).number);
      },
    );
  jest
    .spyOn(FixProductionVerifier, "findDeployContainingFix")
    .mockImplementation(async (): Promise<FixDeploy | null> => {
      return deploy;
    });
  jest
    .spyOn(SecurityCasePullRequestService, "updateColumnsByIdWithoutHooks")
    .mockImplementation(async (asked: unknown): Promise<void> => {
      writes.push(asked as JSONObject);
    });
  jest
    .spyOn(SecurityCaseFeedService, "createSecurityCaseFeedItem")
    .mockImplementation(async (asked: unknown) => {
      feedItems.push(asked as JSONObject);
      return undefined as never;
    });
  jest
    .spyOn(SecurityCaseStepChecks, "requestCheck")
    .mockImplementation(async (asked: unknown): Promise<void> => {
      checksAsked.push(asked as JSONObject);
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function follow(
  row: SecurityCasePullRequest,
): Promise<PullRequestFollowed> {
  return await SecurityCasePullRequestFollower.followOne({
    row,
    run: {
      now: NOW,
      tokens: new Map<string, string | null>(),
      failedCompares: new Set<string>(),
    },
  });
}

describe("an open pull request a person linked", () => {
  test("still open: only when it was followed is written, the row's own update time left alone, and nothing is checked", async () => {
    expect(await follow(linkRow())).toEqual({
      isChanged: false,
      isShipped: false,
    });
    expect(writes).toEqual([
      {
        id: linkRow().id,
        data: { followedAt: NOW },
        skipUpdateDateColumn: true,
      },
    ]);
    expect(checksAsked).toEqual([]);
    expect(feedItems).toEqual([]);
  });

  test("merged: its state, merge commit and moment written, its deploy looked for at once, and the Fix step checked", async () => {
    read = async (): Promise<CodeHostPullRequestState> => {
      return {
        state: PullRequestState.Merged,
        mergeCommitSha: MERGE_SHA,
        mergedAt: MERGED_AT,
      };
    };

    expect(await follow(linkRow())).toEqual({
      isChanged: true,
      isShipped: false,
    });
    expect(writes[0]).toEqual({
      id: linkRow().id,
      data: {
        followedAt: NOW,
        pullRequestState: PullRequestState.Merged,
        mergedAt: MERGED_AT,
        mergeCommitSha: MERGE_SHA,
      },
      skipUpdateDateColumn: false,
    });
    // The deploy is looked for by the commit it merged as, from when it merged.
    expect(
      jest.mocked(FixProductionVerifier.findDeployContainingFix).mock
        .calls[0]![0],
    ).toMatchObject({
      fix: { mergeCommitSha: MERGE_SHA, repoName: "search" },
      mergedAt: MERGED_AT,
    });
    expect(checksAsked).toEqual([
      { projectId: PROJECT_ID, securityCaseId: CASE_ID },
    ]);
  });

  test("closed without merging: written and checked, no deploy looked for", async () => {
    read = async (): Promise<CodeHostPullRequestState> => {
      return { state: PullRequestState.Closed };
    };

    await follow(linkRow());

    expect(writes[0]!["data"]).toEqual({
      followedAt: NOW,
      pullRequestState: PullRequestState.Closed,
    });
    expect(
      FixProductionVerifier.findDeployContainingFix,
    ).not.toHaveBeenCalled();
    expect(checksAsked).toHaveLength(1);
  });

  test("a host that does not answer: followed again next time, and never thrown", async () => {
    read = async (): Promise<CodeHostPullRequestState> => {
      throw new LinkedPullRequestReadError(
        LinkedPullRequestReadProblem.ReadFailed,
        "The server did not answer.",
      );
    };

    expect(await follow(linkRow())).toEqual({
      isChanged: false,
      isShipped: false,
    });
    expect(writes).toEqual([
      {
        id: linkRow().id,
        data: { followedAt: NOW },
        skipUpdateDateColumn: true,
      },
    ]);
    expect(checksAsked).toEqual([]);
  });
});

describe("a merged one, matched to the deploy that shipped it", () => {
  const merged: () => SecurityCasePullRequest = (): SecurityCasePullRequest => {
    return linkRow({
      pullRequestState: PullRequestState.Merged,
      mergeCommitSha: MERGE_SHA,
      mergedAt: MERGED_AT,
    });
  };

  test("shipped: the deploy on its row and on the case's timeline, and the Fix step checked at once", async () => {
    deploy = {
      changeId: "change-1",
      time: DEPLOYED_AT,
      version: "2.4.1",
      commitSha: DEPLOY_SHA,
    };

    expect(await follow(merged())).toEqual({
      isChanged: true,
      isShipped: true,
    });
    expect(LinkedPullRequestReader.readState).not.toHaveBeenCalled();
    expect(writes[0]).toEqual({
      id: linkRow().id,
      data: {
        followedAt: NOW,
        deployedAt: DEPLOYED_AT,
        deployedVersion: "2.4.1",
        deployedCommitSha: DEPLOY_SHA,
      },
      skipUpdateDateColumn: false,
    });
    expect(feedItems).toEqual([
      expect.objectContaining({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        eventType: SecurityCaseFeedEventType.ResponseAction,
        // When it shipped, not when OneUptime saw it.
        postedAt: DEPLOYED_AT,
        feedInfoInMarkdown: pullRequestShippedMarkdown({
          name: "acme/search#482",
          url: URL_OF_IT,
          deploy: "version 2.4.1",
        }).toString(),
      }),
    ]);
    expect(checksAsked).toEqual([
      { projectId: PROJECT_ID, securityCaseId: CASE_ID },
    ]);
  });

  test("what the follower wrote is what the Fix step reads: a person's pull request, merged and deployed", async () => {
    deploy = {
      changeId: "change-1",
      time: DEPLOYED_AT,
      version: "2.4.1",
      commitSha: DEPLOY_SHA,
    };

    const row: SecurityCasePullRequest = merged();

    await follow(row);
    Object.assign(row, writes[0]!["data"]);

    const fix: FixPullRequest = readLinkedPullRequest(row);

    expect(fix).toEqual({
      id: row.id!.toString(),
      isLinked: true,
      number: 482,
      url: URL_OF_IT,
      host: "GitHub",
      state: PullRequestState.Merged,
      mergedAt: MERGED_AT,
      deployedAt: DEPLOYED_AT,
      deployedVersion: "2.4.1",
      deployedCommitSha: DEPLOY_SHA,
    });
  });

  test("no deploy of it yet: only when it was followed is written", async () => {
    expect(await follow(merged())).toEqual({
      isChanged: false,
      isShipped: false,
    });
    expect(writes[0]!["data"]).toEqual({ followedAt: NOW });
    expect(feedItems).toEqual([]);
    expect(checksAsked).toEqual([]);
  });

  test("merged with no merge commit the host would say: nothing to match a deploy to", async () => {
    await follow(linkRow({ pullRequestState: PullRequestState.Merged }));

    expect(
      FixProductionVerifier.findDeployContainingFix,
    ).not.toHaveBeenCalled();
  });

  test("shipped already: never followed again", async () => {
    await follow(
      linkRow({
        pullRequestState: PullRequestState.Merged,
        mergeCommitSha: MERGE_SHA,
        deployedAt: DEPLOYED_AT,
      }),
    );

    expect(
      FixProductionVerifier.findDeployContainingFix,
    ).not.toHaveBeenCalled();
    expect(LinkedPullRequestReader.readState).not.toHaveBeenCalled();
  });
});

describe("every link still to follow", () => {
  test("open ones, and merged ones waiting for a deploy as long as an AI fix's is waited for: the longest-waiting first, each on its own", async () => {
    const findBy: SpyInstance<typeof SecurityCasePullRequestService.findBy> =
      jest
        .spyOn(SecurityCasePullRequestService, "findBy")
        .mockResolvedValueOnce([
          linkRow({ pullRequestNumber: 1 }),
          linkRow({ pullRequestNumber: 2 }),
        ])
        .mockResolvedValueOnce([
          linkRow({
            pullRequestNumber: 3,
            pullRequestState: PullRequestState.Merged,
            mergeCommitSha: MERGE_SHA,
            mergedAt: MERGED_AT,
          }),
        ]);

    // The first host does not answer; the others are followed all the same.
    read = async (number: number): Promise<CodeHostPullRequestState> => {
      if (number === 1) {
        throw new Error("socket hang up");
      }

      return { state: PullRequestState.Merged, mergeCommitSha: MERGE_SHA };
    };

    expect(await SecurityCasePullRequestFollower.followAll(NOW)).toBe(3);
    expect(writes).toHaveLength(3);

    const [openQuery, mergedQuery] = findBy.mock.calls.map(
      (call: Array<unknown>): JSONObject => {
        return call[0] as JSONObject;
      },
    );

    expect(openQuery).toMatchObject({
      query: { pullRequestState: PullRequestState.Open },
      sort: { followedAt: SortOrder.Ascending },
      limit: SECURITY_CASE_PULL_REQUEST_FOLLOW_BATCH,
      props: { isRoot: true },
    });

    const waiting: JSONObject = mergedQuery!["query"] as JSONObject;

    expect(waiting["pullRequestState"]).toBe(PullRequestState.Merged);
    expect(waiting["deployedAt"]).toBeInstanceOf(IsNull);
    expect(waiting["mergedAt"]).toBeInstanceOf(GreaterThan);
    // Fourteen days, as long as OneUptime waits for an AI fix's deploy.
    expect((waiting["mergedAt"] as GreaterThan<Date>).value).toEqual(
      new Date("2026-11-04T12:00:00.000Z"),
    );
  });

  test("links that cannot be read at all: none followed, and nothing thrown", async () => {
    jest
      .spyOn(SecurityCasePullRequestService, "findBy")
      .mockRejectedValue(new Error("connection refused"));

    expect(await SecurityCasePullRequestFollower.followAll(NOW)).toBe(0);
    expect(writes).toEqual([]);
  });

  test("one just linked, merged already: read in its project, followed now", async () => {
    const findOneBy: SpyInstance<
      typeof SecurityCasePullRequestService.findOneBy
    > = jest
      .spyOn(SecurityCasePullRequestService, "findOneBy")
      .mockResolvedValueOnce(
        linkRow({
          pullRequestState: PullRequestState.Merged,
          mergeCommitSha: MERGE_SHA,
          mergedAt: MERGED_AT,
        }),
      )
      .mockResolvedValueOnce(null);

    deploy = {
      changeId: "change-1",
      time: DEPLOYED_AT,
      commitSha: DEPLOY_SHA,
    };

    expect(
      await SecurityCasePullRequestFollower.followById({
        projectId: PROJECT_ID,
        id: linkRow().id!,
        now: NOW,
      }),
    ).toEqual({ isChanged: true, isShipped: true });
    expect(findOneBy.mock.calls[0]![0]).toMatchObject({
      query: { _id: linkRow().id, projectId: PROJECT_ID },
      props: { isRoot: true },
    });
    // No version: the deploy is named by its commit.
    expect(String(feedItems[0]!["feedInfoInMarkdown"])).toBe(
      pullRequestShippedMarkdown({
        name: "acme/search#482",
        url: URL_OF_IT,
        deploy: "commit 9f8e7d6",
      }).toString(),
    );

    // Taken off before it was followed: nothing to do.
    expect(
      await SecurityCasePullRequestFollower.followById({
        projectId: PROJECT_ID,
        id: linkRow().id!,
      }),
    ).toEqual({ isChanged: false, isShipped: false });
  });
});
