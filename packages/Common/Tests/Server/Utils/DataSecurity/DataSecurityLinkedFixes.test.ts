// The checks reach the job queue, which needs Redis; nothing here queues.
jest.mock("../../../../Server/Utils/DataSecurity/DataSecurityJobs", () => {
  return {
    queueDataSecurityEvaluation: jest.fn(),
    queueDataSecurityConnectionRead: jest.fn(),
    queueDataStoreScan: jest.fn(),
  };
});

import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import AIAgentTaskPullRequest from "../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import DataSecurityIssue from "../../../../Models/DatabaseModels/DataSecurityIssue";
import { DataSecurityIssueFeedEventType } from "../../../../Models/DatabaseModels/DataSecurityIssueFeed";
import DataSecurityIssuePullRequest from "../../../../Models/DatabaseModels/DataSecurityIssuePullRequest";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import AIAgentTaskPullRequestService from "../../../../Server/Services/AIAgentTaskPullRequestService";
import DataSecurityIssueFeedService from "../../../../Server/Services/DataSecurityIssueFeedService";
import DataSecurityIssuePullRequestService from "../../../../Server/Services/DataSecurityIssuePullRequestService";
import DataSecurityIssueService from "../../../../Server/Services/DataSecurityIssueService";
import DataStoreFeedService from "../../../../Server/Services/DataStoreFeedService";
import DataStoreService from "../../../../Server/Services/DataStoreService";
import DataSecurityFixTarget, {
  DataSecurityFixTargetRead,
} from "../../../../Server/Utils/AI/CodeFix/DataSecurityFixTarget";
import FixProductionVerifier, {
  FixDeploy,
  VerifierRun,
  isLinkedFix,
} from "../../../../Server/Utils/AI/CodeFix/FixProductionVerifier";
import StoreConfigurationFixWatch from "../../../../Server/Utils/AI/CodeFix/StoreConfigurationFixWatch";
import TelemetryLeakFixReads from "../../../../Server/Utils/AI/CodeFix/TelemetryLeakFixReads";
import TelemetryLeakFixWatch from "../../../../Server/Utils/AI/CodeFix/TelemetryLeakFixWatch";
import DataSecurityAiProposals from "../../../../Server/Utils/AI/DataSecurity/DataSecurityAiProposals";
import { CodeHostPullRequestState } from "../../../../Server/Utils/CodeRepository/CodeHost/CodeHostTypes";
import LinkedPullRequestFollower from "../../../../Server/Utils/CodeRepository/LinkedPullRequests/LinkedPullRequestFollower";
import LinkedPullRequestReader from "../../../../Server/Utils/CodeRepository/LinkedPullRequests/LinkedPullRequestReader";
import DataSecurityFixNotAppliedNotice from "../../../../Server/Utils/DataSecurity/DataSecurityFixNotAppliedNotice";
import DataSecurityIssueAlerts from "../../../../Server/Utils/DataSecurity/DataSecurityIssueAlerts";
import DataSecurityIssueResolutions from "../../../../Server/Utils/DataSecurity/DataSecurityIssueResolutions";
import DataSecurityLinkedFixes, {
  DATA_SECURITY_ISSUE_PULL_REQUESTS,
  LINKED_FIX_SELECT,
  cannotTellFixMarkdown,
  closedFixMarkdown,
  getLinkedFixName,
  linkedFixMarkdown,
  unlinkedFixMarkdown,
} from "../../../../Server/Utils/DataSecurity/DataSecurityLinkedFixes";
import DataSecurityRunner from "../../../../Server/Utils/DataSecurity/DataSecurityRunner";
import { ContentScanOptions } from "../../../../Server/Utils/DataSecurity/DataSecurityScanTypes";
import logger from "../../../../Server/Utils/Logger";
import { TelemetryLeakFixBaseline } from "../../../../Types/AI/FixProductionBaseline";
import FixProductionCheck from "../../../../Types/AI/FixProductionCheck";
import FixProductionStatus from "../../../../Types/AI/FixProductionStatus";
import URL from "../../../../Types/API/URL";
import CodeRepositoryType from "../../../../Types/CodeRepository/CodeRepositoryType";
import PullRequestState from "../../../../Types/CodeRepository/PullRequestState";
import { SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID } from "../../../../Types/DataSecurity/DataSecurityCheckCatalog";
import DataSecurityIssueResolution from "../../../../Types/DataSecurity/DataSecurityIssueResolution";
import DataSecurityIssueStatus from "../../../../Types/DataSecurity/DataSecurityIssueStatus";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

/*
 * A PERSON'S OWN FIX OF A DATA SECURITY ISSUE, FOLLOWED TO PRODUCTION
 * (#10831): the pull request they linked on the issue's page, followed by
 * the one follower of linked pull requests while it is open, then by the
 * same production checks an AI fix of the issue gets - its deploy, its new
 * version watched, the issue resolved as Fixed in code with the pull
 * request and the version - each written on the link's own row, never on
 * OneUptime AI's.
 *
 * The database, the code host, the deploys and the telemetry are stood in
 * for; every step in between is the product's own.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6b6b6b6b-0000-4000-8000-000000000001",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "6b6b6b6b-0000-4000-8000-000000000002",
);
const STORE_ID: ObjectID = new ObjectID("6b6b6b6b-0000-4000-8000-000000000003");
const ISSUE_ID: ObjectID = new ObjectID("6b6b6b6b-0000-4000-8000-000000000004");
const LINK_ID: ObjectID = new ObjectID("6b6b6b6b-0000-4000-8000-000000000005");
const FINDING_ID: ObjectID = new ObjectID(
  "6b6b6b6b-0000-4000-8000-000000000006",
);
const MAYA_ID: ObjectID = new ObjectID("6b6b6b6b-0000-4000-8000-000000000007");
const RUN_ID: ObjectID = new ObjectID("6b6b6b6b-0000-4000-8000-000000000008");
const CONNECTION_ID: ObjectID = new ObjectID(
  "6b6b6b6b-0000-4000-8000-000000000009",
);

const HOUR: number = 60 * 60 * 1000;
const LINKED_AT: Date = new Date("2026-11-19T09:00:00.000Z");
const MERGED_AT: Date = new Date("2026-11-20T10:00:00.000Z");
const DEPLOYED_AT: Date = new Date(MERGED_AT.getTime() + 2 * HOUR);
const GRACE: number = 10 * 60 * 1000;
const MERGE_SHA: string = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b";
const ADDRESS: string = "https://github.com/acme/checkout/pull/482";

const OPTIONS: ContentScanOptions = {
  limits: {
    maxObjects: 2000,
    maxBytesPerObject: 65536,
    maxBytesTotal: 52428800,
    maxRowsPerTable: 1000,
    maxTables: 200,
    deadline: new Date("2026-11-22T11:00:00.000Z"),
  },
  customDetectors: [],
  extraHints: [],
  disabledDataTypeIds: new Set<string>(),
  allowedValues: new Set<string>(),
  exclusions: [],
  fingerprintKey: "linked-fixes-test",
};

// What the leak's check kept when the pull request was linked: an email in checkout's logs.
const BASELINE: TelemetryLeakFixBaseline = {
  serviceId: SERVICE_ID.toString(),
  stores: [
    {
      dataStoreId: STORE_ID.toString(),
      kind: DataStoreKind.TelemetryLogs,
      issueIds: [ISSUE_ID.toString()],
      places: [
        {
          findingId: FINDING_ID.toString(),
          dataTypeId: "email-address",
          location: "attributes.user.email",
          scrubRuleIds: [],
          lastSeenAt: new Date(LINKED_AT.getTime() - 3 * HOUR).toISOString(),
        },
      ],
      recordsBefore: 4210,
      recordsBeforeHour: new Date(LINKED_AT.getTime() - 3 * HOUR).toISOString(),
    },
  ],
  valuesChangedBefore: 0,
  from: new Date(LINKED_AT.getTime() - 7 * 24 * HOUR).toISOString(),
  to: LINKED_AT.toISOString(),
};

function repository(): CodeRepository {
  const row: CodeRepository = new CodeRepository();
  row.id = new ObjectID("6b6b6b6b-0000-4000-8000-00000000000a");
  row.projectId = PROJECT_ID;
  row.repositoryHostedAt = CodeRepositoryType.GitHub;
  row.organizationName = "acme";
  row.repositoryName = "checkout";
  return row;
}

// A link's fields, any of them cleared with undefined (one not read yet).
type LinkRowFields = {
  [K in keyof DataSecurityIssuePullRequest]?:
    | DataSecurityIssuePullRequest[K]
    | undefined;
};

function linkRow(overrides: LinkRowFields = {}): DataSecurityIssuePullRequest {
  return Object.assign(new DataSecurityIssuePullRequest(LINK_ID), {
    projectId: PROJECT_ID,
    dataSecurityIssueId: ISSUE_ID,
    createdByUserId: MAYA_ID,
    createdAt: LINKED_AT,
    pullRequestUrl: URL.fromString(ADDRESS),
    pullRequestNumber: 482,
    repoOrganizationName: "acme",
    repoName: "checkout",
    pullRequestState: PullRequestState.Open,
    productionCheck: FixProductionCheck.TelemetryLeak,
    codeRepository: repository(),
    ...overrides,
  });
}

function runAt(now: Date): VerifierRun {
  return {
    now,
    tokens: new Map<string, string | null>(),
    failedCompares: new Set<string>(),
  };
}

let linkWrites: Array<JSONObject>;
let aiWrites: Array<JSONObject>;
let feedItems: Array<JSONObject>;
let notes: Array<JSONObject>;
let hostSays: CodeHostPullRequestState;
let deploy: FixDeploy | null;

beforeEach(() => {
  linkWrites = [];
  aiWrites = [];
  feedItems = [];
  notes = [];
  hostSays = { state: PullRequestState.Open };
  deploy = null;

  jest
    .spyOn(DataSecurityIssuePullRequestService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (data: {
      id: ObjectID;
      data: JSONObject;
    }): Promise<void> => {
      linkWrites.push({ id: data.id.toString(), ...data.data });
    }) as never);
  jest
    .spyOn(AIAgentTaskPullRequestService, "updateOneById")
    .mockImplementation((async (data: { data: JSONObject }): Promise<void> => {
      aiWrites.push(data.data);
    }) as never);
  jest
    .spyOn(DataSecurityIssueFeedService, "createDataSecurityIssueFeedItem")
    .mockImplementation((async (data: JSONObject): Promise<void> => {
      feedItems.push(data);
    }) as never);
  jest
    .spyOn(DataStoreFeedService, "createDataStoreFeedItem")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(DataSecurityIssueResolutions, "noteOnIssues")
    .mockImplementation((async (data: JSONObject): Promise<void> => {
      notes.push({
        ...data,
        markdown: String((data["markdown"] as { toString(): string }) || ""),
      });
    }) as never);
  jest
    .spyOn(LinkedPullRequestReader, "readState")
    .mockImplementation(async (): Promise<CodeHostPullRequestState> => {
      return hostSays;
    });
  jest
    .spyOn(FixProductionVerifier, "findDeployContainingFix")
    .mockImplementation(async (): Promise<FixDeploy | null> => {
      return deploy;
    });
  jest.spyOn(FixProductionVerifier, "versionToRead").mockResolvedValue("2.4.1");
  jest
    .spyOn(TelemetryLeakFixReads, "readValuesChanged")
    .mockResolvedValue({ valuesChanged: 0, versions: [] });
  jest.spyOn(TelemetryLeakFixReads, "countRecords").mockResolvedValue(4300);
  jest
    .spyOn(TelemetryLeakFixReads, "findDataAtPlaces")
    .mockResolvedValue({ recordsRead: 300, recordsWithData: 0, versions: [] });
  jest
    .spyOn(DataSecurityRunner, "getScanSetup")
    .mockResolvedValue({ options: OPTIONS } as never);
  jest.spyOn(DataSecurityAiProposals, "onIssuesClosed").mockResolvedValue();
  jest
    .spyOn(DataSecurityIssueAlerts, "resolveForClosedIssues")
    .mockResolvedValue(0);
  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * ---------------------------------------------------------------------------
 * Scenario: a linked pull request followed to merge, deploy and a passing check
 * ---------------------------------------------------------------------------
 */

describe("scenario: a person's own fix of a leak, followed to its merge, its deploy and a passing check", () => {
  test("merged, shipped in 2.4.1, and a day of silence later: the issue is Fixed in code, by the person's pull request", async () => {
    const marked: jest.SpyInstance = jest
      .spyOn(DataSecurityIssueResolutions, "markFixedInCode")
      .mockResolvedValue([ISSUE_ID]);
    const row: DataSecurityIssuePullRequest = linkRow({
      productionBaseline: { telemetryLeak: BASELINE },
    });

    // 1. The follower reads the merge: its check now waits for the deploy, and starts at once.
    hostSays = {
      state: PullRequestState.Merged,
      mergeCommitSha: MERGE_SHA,
      mergedAt: MERGED_AT,
    };

    expect(
      await LinkedPullRequestFollower.followOne({
        kind: DATA_SECURITY_ISSUE_PULL_REQUESTS,
        row,
        run: runAt(new Date(MERGED_AT.getTime() + 5 * 60 * 1000)),
      }),
    ).toMatchObject({ isChanged: true, isMerged: true, isShipped: false });

    expect(linkWrites[0]).toMatchObject({
      id: LINK_ID.toString(),
      pullRequestState: PullRequestState.Merged,
      mergeCommitSha: MERGE_SHA,
      mergedAt: MERGED_AT,
      productionCheck: FixProductionCheck.TelemetryLeak,
      productionStatus: FixProductionStatus.AwaitingDeploy,
      productionSummary:
        "Merged. Waiting for a recorded deploy of the service that contains the fix.",
    });
    // No deploy yet: the check waits, and says nothing.
    expect(linkWrites).toHaveLength(1);
    expect(notes).toEqual([]);

    // 2. The deploy that ships it: found by the verifier, as an AI fix's is.
    deploy = {
      changeId: "change-1",
      time: DEPLOYED_AT,
      version: "2.4.1",
      commitSha: MERGE_SHA,
    };

    await FixProductionVerifier.verifyFix(
      row,
      runAt(new Date(DEPLOYED_AT.getTime() + 30 * 60 * 1000)),
    );

    expect(notes[0]).toMatchObject({
      issueIds: [ISSUE_ID],
      eventType: DataSecurityIssueFeedEventType.FixShipped,
    });
    expect(notes[0]!["markdown"]).toContain(
      "merged and shipped in version 2.4.1",
    );
    expect(linkWrites[linkWrites.length - 1]).toMatchObject({
      productionStatus: FixProductionStatus.Watching,
      deployedAt: DEPLOYED_AT,
      deployedVersion: "2.4.1",
      deployedCommitSha: MERGE_SHA,
    });

    // 3. A day into 2.4.1, as much traffic as before and none of it the data.
    Object.assign(row, {
      productionStatus: FixProductionStatus.Watching,
      productionSummary: "still watching",
      deployedAt: DEPLOYED_AT,
      deployedVersion: "2.4.1",
    });

    await FixProductionVerifier.verifyFix(
      row,
      runAt(new Date(DEPLOYED_AT.getTime() + GRACE + 25 * HOUR)),
    );

    expect(linkWrites[linkWrites.length - 1]).toMatchObject({
      productionStatus: FixProductionStatus.Verified,
    });
    expect(marked).toHaveBeenCalledTimes(1);
    expect(marked.mock.calls[0]![0]).toMatchObject({
      projectId: PROJECT_ID,
      issueIds: [ISSUE_ID],
      fix: {
        pullRequestId: LINK_ID.toString(),
        number: 482,
        url: ADDRESS,
        repository: "acme/checkout",
        version: "2.4.1",
        deployedAt: DEPLOYED_AT.toISOString(),
      },
    });
    // A person's pull request has no task in Code to open.
    expect(
      (marked.mock.calls[0]![0] as { fix: JSONObject }).fix["taskId"],
    ).toBeUndefined();
    // OneUptime AI's pull requests are never written for a person's.
    expect(aiWrites).toEqual([]);
  });

  test("its new version still writing the data: the fix did not stop it, and the issue says so", async () => {
    jest.spyOn(TelemetryLeakFixReads, "findDataAtPlaces").mockResolvedValue({
      recordsRead: 40,
      recordsWithData: 2,
      versions: ["2.4.1"],
    });
    const marked: jest.SpyInstance = jest.spyOn(
      DataSecurityIssueResolutions,
      "markFixedInCode",
    );
    const row: DataSecurityIssuePullRequest = linkRow({
      pullRequestState: PullRequestState.Merged,
      mergedAt: MERGED_AT,
      mergeCommitSha: MERGE_SHA,
      productionStatus: FixProductionStatus.Watching,
      productionStatusAt: DEPLOYED_AT,
      deployedAt: DEPLOYED_AT,
      deployedVersion: "2.4.1",
      productionBaseline: { telemetryLeak: BASELINE },
    });

    await FixProductionVerifier.verifyFix(
      row,
      runAt(new Date(DEPLOYED_AT.getTime() + GRACE + 2 * HOUR)),
    );

    expect(linkWrites[linkWrites.length - 1]).toMatchObject({
      productionStatus: FixProductionStatus.Regressed,
      productionSummary:
        "Version 2.4.1 still writes the data: 2 of its records held it after it shipped the fix.",
    });
    expect(marked).not.toHaveBeenCalled();
    expect(notes[notes.length - 1]).toMatchObject({
      eventType: DataSecurityIssueFeedEventType.FixRegressed,
    });
    expect(notes[notes.length - 1]!["markdown"]).toContain(
      "[#482](https://github.com/acme/checkout/pull/482)",
    );
  });

  test("closed without merging: the issue says so, and nothing more is followed", async () => {
    const verify: jest.SpyInstance = jest.spyOn(
      FixProductionVerifier,
      "verifyFix",
    );

    hostSays = { state: PullRequestState.Closed };

    const row: DataSecurityIssuePullRequest = linkRow();

    expect(
      await LinkedPullRequestFollower.followOne({
        kind: DATA_SECURITY_ISSUE_PULL_REQUESTS,
        row,
        run: runAt(MERGED_AT),
      }),
    ).toMatchObject({ isChanged: true, isClosed: true });

    expect(linkWrites).toEqual([
      expect.objectContaining({
        pullRequestState: PullRequestState.Closed,
        followedAt: MERGED_AT,
      }),
    ]);
    expect(linkWrites[0]!["productionStatus"]).toBeUndefined();
    expect(feedItems).toEqual([
      expect.objectContaining({
        dataSecurityIssueId: ISSUE_ID,
        eventType: DataSecurityIssueFeedEventType.FixClosed,
        feedInfoInMarkdown: closedFixMarkdown({
          name: "acme/checkout#482",
          url: ADDRESS,
        }).toString(),
      }),
    ]);
    expect(verify).not.toHaveBeenCalled();
  });

  test("still open: only when it was followed is written, and no check runs", async () => {
    const verify: jest.SpyInstance = jest.spyOn(
      FixProductionVerifier,
      "verifyFix",
    );

    expect(
      await LinkedPullRequestFollower.followOne({
        kind: DATA_SECURITY_ISSUE_PULL_REQUESTS,
        row: linkRow(),
        run: runAt(MERGED_AT),
      }),
    ).toMatchObject({ isChanged: false });
    expect(linkWrites).toEqual([
      { id: LINK_ID.toString(), followedAt: MERGED_AT },
    ]);
    expect(verify).not.toHaveBeenCalled();
    expect(feedItems).toEqual([]);
  });

  test("the follower never looks for a linked fix's deploy itself: its check does, with the service it watches", async () => {
    hostSays = {
      state: PullRequestState.Merged,
      mergeCommitSha: MERGE_SHA,
      mergedAt: MERGED_AT,
    };
    jest.spyOn(FixProductionVerifier, "verifyFix").mockResolvedValue();
    const deploys: jest.SpyInstance = jest.spyOn(
      FixProductionVerifier,
      "findDeployContainingFix",
    );

    await LinkedPullRequestFollower.followOne({
      kind: DATA_SECURITY_ISSUE_PULL_REQUESTS,
      row: linkRow(),
      run: runAt(MERGED_AT),
    });

    expect(DATA_SECURITY_ISSUE_PULL_REQUESTS.findsDeploy).toBe(false);
    expect(deploys).not.toHaveBeenCalled();
    expect(linkWrites[0]!["deployedAt"]).toBeUndefined();
  });

  test("the follower reads the open links only, the longest-waiting first, with what the checks need", async () => {
    const reads: jest.SpyInstance = jest
      .spyOn(DataSecurityIssuePullRequestService, "findBy")
      .mockResolvedValue([] as never);

    expect(await DataSecurityLinkedFixes.followAll(MERGED_AT)).toBe(0);
    expect(reads.mock.calls[0]![0]).toMatchObject({
      query: { pullRequestState: PullRequestState.Open },
      select: LINKED_FIX_SELECT,
      sort: { followedAt: "ASC" },
      props: { isRoot: true },
    });
  });
});

/*
 * ---------------------------------------------------------------------------
 * Scenario: a person's own Terraform fix of a store
 * ---------------------------------------------------------------------------
 */

describe("scenario: a person's own fix of a store's configuration", () => {
  function storeIssue(
    overrides: Partial<DataSecurityIssue> = {},
  ): DataSecurityIssue {
    return Object.assign(new DataSecurityIssue(ISSUE_ID), {
      dataStoreId: STORE_ID,
      checkId: "aws-s3-public-access-block",
      status: DataSecurityIssueStatus.Open,
      ...overrides,
    });
  }

  test("merged: the store is read again at once and the issue told; applied, the issue is Fixed in infrastructure code by it", async () => {
    let issueNow: DataSecurityIssue = storeIssue();

    jest
      .spyOn(DataSecurityIssueService, "findOneBy")
      .mockImplementation((async (): Promise<DataSecurityIssue> => {
        return issueNow;
      }) as never);
    jest
      .spyOn(DataSecurityIssueService, "findBy")
      .mockImplementation((async (): Promise<Array<DataSecurityIssue>> => {
        return [issueNow];
      }) as never);
    jest.spyOn(DataStoreService, "findBy").mockResolvedValue([
      Object.assign(new DataStore(STORE_ID), {
        cloudConnectionId: CONNECTION_ID,
      }),
    ] as never);
    const applied: jest.SpyInstance = jest
      .spyOn(DataSecurityIssueResolutions, "markFixedInInfrastructureCode")
      .mockResolvedValue([ISSUE_ID]);
    // Resolves to how many it emailed: none, as it is never sent here.
    const notice: jest.SpyInstance = jest
      .spyOn(DataSecurityFixNotAppliedNotice, "send")
      .mockResolvedValue(0);
    const row: DataSecurityIssuePullRequest = linkRow({
      productionCheck: FixProductionCheck.StoreConfiguration,
      pullRequestUrl: URL.fromString("https://github.com/acme/infra/pull/57"),
      pullRequestNumber: 57,
      repoName: "infra",
    });

    hostSays = {
      state: PullRequestState.Merged,
      mergeCommitSha: MERGE_SHA,
      mergedAt: MERGED_AT,
    };

    await LinkedPullRequestFollower.followOne({
      kind: DATA_SECURITY_ISSUE_PULL_REQUESTS,
      row,
      run: runAt(new Date(MERGED_AT.getTime() + 5 * 60 * 1000)),
    });

    // Its issue kept, the person who linked it as who asked, on the link's row.
    const baselineWrite: JSONObject | undefined = linkWrites.find(
      (write: JSONObject): boolean => {
        return Boolean(write["productionBaseline"]);
      },
    );

    expect(baselineWrite?.["productionBaseline"]).toMatchObject({
      storeConfiguration: {
        issues: [
          {
            issueId: ISSUE_ID.toString(),
            dataStoreId: STORE_ID.toString(),
          },
        ],
        askedByUserId: MAYA_ID.toString(),
      },
    });
    expect(
      (baselineWrite?.["productionBaseline"] as JSONObject)[
        "storeConfiguration"
      ] as JSONObject,
    ).not.toHaveProperty("taskId");
    expect(notes[0]).toMatchObject({
      issueIds: [ISSUE_ID],
      eventType: DataSecurityIssueFeedEventType.FixShipped,
    });
    expect(notes[0]!["markdown"]).toContain("The store is being read again");

    // The change applied: the issue resolved as its check passed, after the merge.
    issueNow = storeIssue({
      status: DataSecurityIssueStatus.Resolved,
      resolution: DataSecurityIssueResolution.CheckPassed,
      resolvedAt: new Date(MERGED_AT.getTime() + 3 * HOUR),
    });
    row.productionBaseline = baselineWrite!["productionBaseline"] as never;

    await FixProductionVerifier.verifyFix(
      row,
      runAt(new Date(MERGED_AT.getTime() + 4 * HOUR)),
    );

    expect(applied).toHaveBeenCalledTimes(1);
    expect(applied.mock.calls[0]![0]).toMatchObject({
      issueIds: [ISSUE_ID],
      fix: {
        pullRequestId: LINK_ID.toString(),
        number: 57,
        url: "https://github.com/acme/infra/pull/57",
      },
    });
    expect(linkWrites[linkWrites.length - 1]).toMatchObject({
      productionStatus: FixProductionStatus.Verified,
    });
    expect(notice).not.toHaveBeenCalled();
    expect(aiWrites).toEqual([]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * When it is linked
 * ---------------------------------------------------------------------------
 */

describe("when a person links their fix", () => {
  function linkIsRead(row: DataSecurityIssuePullRequest): void {
    jest
      .spyOn(DataSecurityIssuePullRequestService, "findOneBy")
      .mockResolvedValue(row as never);
    jest.spyOn(DataSecurityIssueService, "findOneBy").mockResolvedValue(
      Object.assign(new DataSecurityIssue(ISSUE_ID), {
        dataStoreId: STORE_ID,
        checkId: SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
      }) as never,
    );
  }

  test("a leak's baseline is taken at once, from the link on: the hour it was last seen, whenever it merges", async () => {
    const row: DataSecurityIssuePullRequest = linkRow();
    const verify: jest.SpyInstance = jest.spyOn(
      FixProductionVerifier,
      "verifyFix",
    );
    const baseline: jest.SpyInstance = jest
      .spyOn(TelemetryLeakFixWatch, "readBaseline")
      .mockResolvedValue(BASELINE);

    linkIsRead(row);

    await DataSecurityLinkedFixes.startFollowing({
      projectId: PROJECT_ID,
      id: LINK_ID,
      now: LINKED_AT,
    });

    expect(baseline.mock.calls[0]![0]).toMatchObject({
      fix: row,
      target: {
        check: FixProductionCheck.TelemetryLeak,
        issueIds: [ISSUE_ID],
        askedByUserId: MAYA_ID,
      },
      // The link is the moment the leak's traffic is weighed before.
      mergedAt: LINKED_AT,
      now: LINKED_AT,
    });
    expect(linkWrites).toEqual([
      {
        id: LINK_ID.toString(),
        productionBaseline: { telemetryLeak: BASELINE },
      },
    ]);
    // Open: nothing to check in production yet.
    expect(verify).not.toHaveBeenCalled();
  });

  test("one that merged before it was linked: its baseline from the link's moment, and its check at once", async () => {
    const row: DataSecurityIssuePullRequest = linkRow({
      pullRequestState: PullRequestState.Merged,
      mergedAt: new Date(LINKED_AT.getTime() - 48 * HOUR),
      mergeCommitSha: MERGE_SHA,
      productionStatus: FixProductionStatus.AwaitingDeploy,
    });
    const verify: jest.SpyInstance = jest
      .spyOn(FixProductionVerifier, "verifyFix")
      .mockResolvedValue();
    const baseline: jest.SpyInstance = jest
      .spyOn(TelemetryLeakFixWatch, "readBaseline")
      .mockResolvedValue(BASELINE);

    linkIsRead(row);

    await DataSecurityLinkedFixes.startFollowing({
      projectId: PROJECT_ID,
      id: LINK_ID,
      now: LINKED_AT,
    });

    expect(baseline.mock.calls[0]![0]).toMatchObject({ mergedAt: LINKED_AT });
    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify.mock.calls[0]![0]).toBe(row);
    expect(row.productionBaseline).toEqual({ telemetryLeak: BASELINE });
  });

  test("a leak nothing can tell about is said there and then, and never checked", async () => {
    const row: DataSecurityIssuePullRequest = linkRow({
      pullRequestState: PullRequestState.Merged,
      mergedAt: MERGED_AT,
      mergeCommitSha: MERGE_SHA,
      productionStatus: FixProductionStatus.AwaitingDeploy,
    });
    const verify: jest.SpyInstance = jest.spyOn(
      FixProductionVerifier,
      "verifyFix",
    );
    const summary: string =
      "The issue this fix was opened for no longer has a finding to watch, so whether the new version still writes the data cannot be told.";

    jest.spyOn(TelemetryLeakFixWatch, "readBaseline").mockResolvedValue({
      status: FixProductionStatus.Unverifiable,
      summary,
    });
    linkIsRead(row);

    await DataSecurityLinkedFixes.startFollowing({
      projectId: PROJECT_ID,
      id: LINK_ID,
      now: LINKED_AT,
    });

    expect(linkWrites).toEqual([
      {
        id: LINK_ID.toString(),
        productionStatus: FixProductionStatus.Unverifiable,
        productionSummary: summary,
        productionStatusAt: LINKED_AT,
      },
    ]);
    expect(notes).toEqual([
      expect.objectContaining({
        issueIds: [ISSUE_ID],
        eventType: DataSecurityIssueFeedEventType.FixUnverifiable,
        markdown: cannotTellFixMarkdown({
          name: "acme/checkout#482",
          url: ADDRESS,
          summary,
        }).toString(),
      }),
    ]);
    expect(verify).not.toHaveBeenCalled();
  });

  test("a store's fix keeps no leak baseline: its check reads the store once it merges", async () => {
    const row: DataSecurityIssuePullRequest = linkRow({
      productionCheck: FixProductionCheck.StoreConfiguration,
    });
    const baseline: jest.SpyInstance = jest.spyOn(
      TelemetryLeakFixWatch,
      "readBaseline",
    );

    linkIsRead(row);

    await DataSecurityLinkedFixes.startFollowing({
      projectId: PROJECT_ID,
      id: LINK_ID,
      now: LINKED_AT,
    });

    expect(baseline).not.toHaveBeenCalled();
    expect(linkWrites).toEqual([]);
  });

  test("a read that fails never undoes the link: the verifier takes the baseline at its next round", async () => {
    const row: DataSecurityIssuePullRequest = linkRow();

    jest
      .spyOn(TelemetryLeakFixWatch, "readBaseline")
      .mockRejectedValue(new Error("ClickHouse timed out"));
    linkIsRead(row);

    await expect(
      DataSecurityLinkedFixes.startFollowing({
        projectId: PROJECT_ID,
        id: LINK_ID,
        now: LINKED_AT,
      }),
    ).resolves.toBeUndefined();
    expect(linkWrites).toEqual([]);
  });

  test("a link gone by the time it is read: nothing happens", async () => {
    jest
      .spyOn(DataSecurityIssuePullRequestService, "findOneBy")
      .mockResolvedValue(null as never);
    const baseline: jest.SpyInstance = jest.spyOn(
      TelemetryLeakFixWatch,
      "readBaseline",
    );

    await DataSecurityLinkedFixes.startFollowing({
      projectId: PROJECT_ID,
      id: LINK_ID,
    });

    expect(baseline).not.toHaveBeenCalled();
  });

  test("a merge sets its check waiting for the deploy - unless it was decided when it was linked", () => {
    const now: Date = new Date("2026-11-20T10:05:00.000Z");

    expect(
      DataSecurityLinkedFixes.productionFieldsWhenMerged({
        row: { productionCheck: FixProductionCheck.TelemetryLeak },
        now,
      }),
    ).toEqual({
      productionCheck: FixProductionCheck.TelemetryLeak,
      productionStatus: FixProductionStatus.AwaitingDeploy,
      productionStatusAt: now,
      productionSummary:
        "Merged. Waiting for a recorded deploy of the service that contains the fix.",
    });

    for (const decided of [
      FixProductionStatus.Unverifiable,
      FixProductionStatus.Verified,
      FixProductionStatus.Regressed,
    ]) {
      expect(
        DataSecurityLinkedFixes.productionFieldsWhenMerged({
          row: {
            productionCheck: FixProductionCheck.TelemetryLeak,
            productionStatus: decided,
          },
          now,
        }),
      ).toEqual({});
    }

    expect(
      DataSecurityLinkedFixes.productionFieldsWhenMerged({ row: {}, now }),
    ).toEqual({});
  });
});

/*
 * ---------------------------------------------------------------------------
 * The verifier and the target, for a linked fix
 * ---------------------------------------------------------------------------
 */

describe("the production checks, for a person's linked fix", () => {
  test("a linked fix is told apart from OneUptime AI's by its issue", () => {
    expect(isLinkedFix(linkRow())).toBe(true);
    expect(
      isLinkedFix({
        id: RUN_ID,
        aiRunId: RUN_ID,
      } as unknown as AIAgentTaskPullRequest),
    ).toBe(false);
  });

  test("its verdict and its baseline go on its own row, never on OneUptime AI's", async () => {
    const row: DataSecurityIssuePullRequest = linkRow({
      productionStatus: FixProductionStatus.AwaitingDeploy,
    });

    await FixProductionVerifier.settle(row, runAt(MERGED_AT), {
      status: FixProductionStatus.Unverifiable,
      summary: "Nothing shipped it.",
    });
    await FixProductionVerifier.saveBaseline(row, { telemetryLeak: BASELINE });

    expect(linkWrites).toEqual([
      {
        id: LINK_ID.toString(),
        productionStatus: FixProductionStatus.Unverifiable,
        productionSummary: "Nothing shipped it.",
        productionStatusAt: MERGED_AT,
      },
      {
        id: LINK_ID.toString(),
        productionBaseline: { telemetryLeak: BASELINE },
      },
    ]);
    expect(aiWrites).toEqual([]);
  });

  test("a leak's is watched by the leak's check, a store's by the store's; any other check is left alone", async () => {
    const leak: jest.SpyInstance = jest
      .spyOn(TelemetryLeakFixWatch, "verify")
      .mockResolvedValue();
    const store: jest.SpyInstance = jest
      .spyOn(StoreConfigurationFixWatch, "verify")
      .mockResolvedValue();
    const run: VerifierRun = runAt(MERGED_AT);

    await FixProductionVerifier.verifyFix(linkRow(), run);
    await FixProductionVerifier.verifyFix(
      linkRow({ productionCheck: FixProductionCheck.StoreConfiguration }),
      run,
    );
    await FixProductionVerifier.verifyFix(
      linkRow({ productionCheck: FixProductionCheck.Exception }),
      run,
    );

    expect(leak).toHaveBeenCalledTimes(1);
    expect(store).toHaveBeenCalledTimes(1);
  });

  test("every run reads the merged linked fixes still to decide, after OneUptime AI's", async () => {
    const linked: DataSecurityIssuePullRequest = linkRow({
      pullRequestState: PullRequestState.Merged,
      productionStatus: FixProductionStatus.Watching,
    });

    jest.spyOn(AIAgentTaskPullRequestService, "findBy").mockResolvedValue([]);
    const reads: jest.SpyInstance = jest
      .spyOn(DataSecurityIssuePullRequestService, "findBy")
      .mockResolvedValue([linked] as never);
    const verified: jest.SpyInstance = jest
      .spyOn(FixProductionVerifier, "verifyFix")
      .mockResolvedValue();
    jest.spyOn(TelemetryLeakFixWatch, "watchVerifiedFixes").mockResolvedValue();

    await FixProductionVerifier.verifyAll();

    expect(reads.mock.calls[0]![0]).toMatchObject({
      query: { pullRequestState: PullRequestState.Merged },
      props: { isRoot: true },
    });
    expect(
      verified.mock.calls.map((call: Array<unknown>) => {
        return call[0];
      }),
    ).toEqual([linked]);
    // What a linked fix is checked with: its issue and who linked it, no AI run.
    const select: JSONObject = FixProductionVerifier.linkedFixSelect();

    expect(select["dataSecurityIssueId"]).toBe(true);
    expect(select["createdByUserId"]).toBe(true);
    expect(select["productionBaseline"]).toBe(true);
    expect(select["aiRunId"]).toBeUndefined();
  });

  test("a linked fixes' read that fails never stops OneUptime AI's", async () => {
    const aiFix: AIAgentTaskPullRequest = {
      id: RUN_ID,
      _id: RUN_ID.toString(),
    } as unknown as AIAgentTaskPullRequest;

    jest
      .spyOn(AIAgentTaskPullRequestService, "findBy")
      .mockResolvedValue([aiFix]);
    jest
      .spyOn(DataSecurityIssuePullRequestService, "findBy")
      .mockRejectedValue(new Error("table locked"));
    const verified: jest.SpyInstance = jest
      .spyOn(FixProductionVerifier, "verifyFix")
      .mockResolvedValue();
    jest.spyOn(TelemetryLeakFixWatch, "watchVerifiedFixes").mockResolvedValue();

    await FixProductionVerifier.verifyAll();

    expect(
      verified.mock.calls.map((call: Array<unknown>) => {
        return call[0];
      }),
    ).toEqual([aiFix]);
  });

  test("its target is its issue, the check it was linked with, and who linked it - no task", async () => {
    jest.spyOn(DataSecurityIssueService, "findOneBy").mockResolvedValue(
      Object.assign(new DataSecurityIssue(ISSUE_ID), {
        dataStoreId: STORE_ID,
      }) as never,
    );

    const target: DataSecurityFixTargetRead | null =
      await DataSecurityFixTarget.readOfFix(linkRow());

    expect(target).toEqual({
      check: FixProductionCheck.TelemetryLeak,
      issueIds: [ISSUE_ID],
      askedByUserId: MAYA_ID,
    });
  });

  test("a link with no check yet takes its store's; one whose issue is gone has no target", async () => {
    const issueRead: jest.SpyInstance = jest
      .spyOn(DataSecurityIssueService, "findOneBy")
      .mockResolvedValue(
        Object.assign(new DataSecurityIssue(ISSUE_ID), {
          dataStoreId: STORE_ID,
        }) as never,
      );
    jest
      .spyOn(DataSecurityFixTarget, "checkOfStore")
      .mockResolvedValue(FixProductionCheck.StoreConfiguration);

    expect(
      (
        await DataSecurityFixTarget.readLink(
          linkRow({ productionCheck: undefined }),
        )
      )?.check,
    ).toBe(FixProductionCheck.StoreConfiguration);
    // Read in the link's own project.
    expect(issueRead.mock.calls[0]![0]).toMatchObject({
      query: { _id: ISSUE_ID.toString(), projectId: PROJECT_ID },
    });

    issueRead.mockResolvedValue(null as never);

    expect(await DataSecurityFixTarget.readLink(linkRow())).toBeNull();
  });

  test("OneUptime AI's fix's target is still its task's", async () => {
    const read: jest.SpyInstance = jest
      .spyOn(DataSecurityFixTarget, "read")
      .mockResolvedValue(null);

    await DataSecurityFixTarget.readOfFix({ aiRunId: RUN_ID });

    expect(read).toHaveBeenCalledWith(RUN_ID);
    expect(await DataSecurityFixTarget.readOfFix({})).toBeNull();
  });
});

/*
 * ---------------------------------------------------------------------------
 * What the issue's timeline says: names and links, never a value
 * ---------------------------------------------------------------------------
 */

describe("the timeline's words for a linked fix", () => {
  test("each line names the pull request and links it, and says what OneUptime does next", () => {
    const linked: string = linkedFixMarkdown({
      name: "acme/checkout#482",
      url: ADDRESS,
      check: FixProductionCheck.TelemetryLeak,
    }).toString();

    expect(linked).toContain(`[acme/checkout#482](${ADDRESS})`);
    expect(linked).toContain("OneUptime follows it to production");
    expect(
      closedFixMarkdown({ name: "acme/checkout#482", url: ADDRESS }).toString(),
    ).toContain("was closed without merging. OneUptime no longer follows it.");
    expect(unlinkedFixMarkdown({ name: "acme/checkout#482" }).toString()).toBe(
      "🔗 Took the pull request **acme/checkout#482** off this issue's fixes.",
    );
  });

  test("an address that is no web page is named, never linked", () => {
    expect(
      linkedFixMarkdown({
        name: "acme/checkout#482",
        url: "javascript:alert(1)",
        check: FixProductionCheck.TelemetryLeak,
      }).toString(),
    ).not.toContain("javascript:");
  });

  test("a link with no repository known yet is named by its address", () => {
    expect(
      getLinkedFixName(
        linkRow({
          repoOrganizationName: undefined,
          repoName: undefined,
          pullRequestNumber: undefined,
        }),
      ),
    ).toBe(ADDRESS);
    expect(getLinkedFixName(linkRow())).toBe("acme/checkout#482");
  });
});
