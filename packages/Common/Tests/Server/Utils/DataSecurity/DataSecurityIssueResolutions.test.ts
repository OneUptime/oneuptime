// The resolutions reach the job queue, which needs Redis; nothing here queues.
jest.mock("../../../../Server/Utils/DataSecurity/DataSecurityJobs", () => {
  return {
    queueDataSecurityEvaluation: jest.fn(),
    queueDataSecurityConnectionRead: jest.fn(),
    queueDataStoreScan: jest.fn(),
  };
});

import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import DataSecurityIssue from "../../../../Models/DatabaseModels/DataSecurityIssue";
import { DataSecurityIssueFeedEventType } from "../../../../Models/DatabaseModels/DataSecurityIssueFeed";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import { DataStoreFeedEventType } from "../../../../Models/DatabaseModels/DataStoreFeed";
import User from "../../../../Models/DatabaseModels/User";
import DataSecurityIssueFeedService from "../../../../Server/Services/DataSecurityIssueFeedService";
import DataSecurityIssueService from "../../../../Server/Services/DataSecurityIssueService";
import DataStoreFeedService from "../../../../Server/Services/DataStoreFeedService";
import DataStoreFindingService from "../../../../Server/Services/DataStoreFindingService";
import DataStoreService from "../../../../Server/Services/DataStoreService";
import MailService from "../../../../Server/Services/MailService";
import UserService from "../../../../Server/Services/UserService";
import DataSecurityAiProposals from "../../../../Server/Utils/AI/DataSecurity/DataSecurityAiProposals";
import DataSecurityFixNotAppliedNotice, {
  buildFixNotAppliedMarkdown,
  describeNotAppliedLine,
  getFixNotAppliedSubject,
} from "../../../../Server/Utils/DataSecurity/DataSecurityFixNotAppliedNotice";
import DataSecurityIntegrations from "../../../../Server/Utils/DataSecurity/DataSecurityIntegrations";
import DataSecurityIssueAlerts from "../../../../Server/Utils/DataSecurity/DataSecurityIssueAlerts";
import DataSecurityIssueReconciler, {
  ReconcileStoreInput,
  ReconcileStoreOutput,
} from "../../../../Server/Utils/DataSecurity/DataSecurityIssueReconciler";
import DataSecurityIssueResolutions, {
  describeFixedInCode,
  describeRegression,
  getResolutionFixOf,
} from "../../../../Server/Utils/DataSecurity/DataSecurityIssueResolutions";
import DataSecurityResponse from "../../../../Server/Utils/DataSecurity/DataSecurityResponse";
import { queueDataSecurityEvaluation } from "../../../../Server/Utils/DataSecurity/DataSecurityJobs";
import logger from "../../../../Server/Utils/Logger";
import AIAgentTaskPullRequest from "../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import URL from "../../../../Types/API/URL";
import { Green500, Red500, Yellow500 } from "../../../../Types/BrandColors";
import {
  DataSecurityCheckStatus,
  EvaluatedCheck,
  SECRETS_IN_TELEMETRY_CHECK_ID,
  SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
  getDataSecurityCheck,
} from "../../../../Types/DataSecurity/DataSecurityCheckCatalog";
import DataSecurityIssueResolution, {
  DataSecurityIssueResolutionFix,
  readDataSecurityIssueResolutionDetails,
} from "../../../../Types/DataSecurity/DataSecurityIssueResolution";
import DataSecurityIssueStatus from "../../../../Types/DataSecurity/DataSecurityIssueStatus";
import { DataSecurityResponseAction } from "../../../../Types/DataSecurity/DataSecurityResponseAction";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import { DataStoreExposure } from "../../../../Types/DataSecurity/DataStorePosture";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import SecuritySeverity from "../../../../Types/SecuritySeverity";

/*
 * HOW AN ISSUE WAS RESOLVED (#10368), on every path that resolves one:
 *
 *   - the reconciler, as checks run: Check passed; Contained at ingest for
 *     a telemetry issue whose data only a scrub rule hides - never fixed;
 *     Fixed from here after a response action; No longer checked; Store
 *     archived; and an issue that opens again forgets how - but a leak
 *     that came back after its verified fix keeps the version that brought
 *     it back, opens again even while a rule hides it, and stays open;
 *   - a fix followed to production (DataSecurityIssueResolutions): Fixed in
 *     code with the pull request and the version, its findings marked
 *     fixed, the rules that contained it kept; Fixed in infrastructure
 *     code; the leak marked as come back;
 *   - a response action, whose change waits for its check to pass;
 *   - the one notice that a fix merged and was not applied.
 *
 * Postgres is stood in for: every write and timeline entry is recorded.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6a3e1d10-0000-4000-8000-000000000001",
);
const STORE_ID: ObjectID = new ObjectID("6a3e1d10-0000-4000-8000-000000000002");
const OWNER_ID: ObjectID = new ObjectID("6a3e1d10-0000-4000-8000-000000000003");
const AUTHOR_ID: ObjectID = new ObjectID(
  "6a3e1d10-0000-4000-8000-000000000004",
);
const PULL_REQUEST_ID: ObjectID = new ObjectID(
  "6a3e1d10-0000-4000-8000-000000000005",
);
const NOW: Date = new Date("2026-11-21T14:10:00.000Z");
const DAY: number = 24 * 60 * 60 * 1000;

const FIX: DataSecurityIssueResolutionFix = {
  pullRequestId: PULL_REQUEST_ID.toString(),
  number: 482,
  url: "https://github.com/acme/checkout/pull/482",
  repository: "acme/checkout",
  version: "2.4.1",
};

interface FeedCall {
  dataSecurityIssueId: ObjectID;
  eventType: DataSecurityIssueFeedEventType;
  displayColor: unknown;
  feedInfoInMarkdown: string;
}

let updateSpy: jest.SpyInstance;
let feedSpy: jest.SpyInstance;
let storeFeedSpy: jest.SpyInstance;
let closedSpy: jest.SpyInstance;
let alertSpy: jest.SpyInstance;

beforeEach(() => {
  updateSpy = jest
    .spyOn(DataSecurityIssueService, "updateOneById")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(DataSecurityIssueService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);
  feedSpy = jest
    .spyOn(DataSecurityIssueFeedService, "createDataSecurityIssueFeedItem")
    .mockResolvedValue(undefined as never);
  storeFeedSpy = jest
    .spyOn(DataStoreFeedService, "createDataStoreFeedItem")
    .mockResolvedValue(undefined as never);
  closedSpy = jest
    .spyOn(DataSecurityAiProposals, "onIssuesClosed")
    .mockResolvedValue(undefined);
  alertSpy = jest
    .spyOn(DataSecurityIssueAlerts, "resolveForClosedIssues")
    .mockResolvedValue(0);
  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
  (queueDataSecurityEvaluation as jest.Mock).mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

function feeds(): Array<FeedCall> {
  return feedSpy.mock.calls.map((call: Array<unknown>): FeedCall => {
    return call[0] as FeedCall;
  });
}

function writes(): Array<{ id: ObjectID; data: JSONObject }> {
  return updateSpy.mock.calls.map(
    (call: Array<unknown>): { id: ObjectID; data: JSONObject } => {
      return call[0] as { id: ObjectID; data: JSONObject };
    },
  );
}

function issueOf(data: {
  checkId: string;
  status: DataSecurityIssueStatus;
  resolution?: DataSecurityIssueResolution | undefined;
  resolutionDetails?: JSONObject | undefined;
  pendingResolution?: JSONObject | undefined;
}): DataSecurityIssue {
  const issue: DataSecurityIssue = new DataSecurityIssue(ObjectID.generate());

  issue.projectId = PROJECT_ID;
  issue.dataStoreId = STORE_ID;
  issue.checkId = data.checkId;
  issue.title = getDataSecurityCheck(data.checkId)?.title || "";
  issue.status = data.status;
  issue.severity = SecuritySeverity.High;
  issue.riskScore = 60;

  if (data.resolution) {
    issue.resolution = data.resolution;
  }

  if (data.resolutionDetails) {
    issue.resolutionDetails = data.resolutionDetails;
  }

  if (data.pendingResolution) {
    issue.pendingResolution = data.pendingResolution;
  }

  return issue;
}

function check(
  checkId: string,
  status: DataSecurityCheckStatus,
  severity: SecuritySeverity | null = null,
): EvaluatedCheck {
  return {
    check: getDataSecurityCheck(checkId)!,
    result: { status, evidence: `Evidence of ${checkId}.` },
    severity,
  };
}

function reconcile(
  overrides: Partial<ReconcileStoreInput>,
): Promise<ReconcileStoreOutput> {
  return DataSecurityIssueReconciler.reconcileStore({
    projectId: PROJECT_ID,
    dataStoreId: STORE_ID,
    exposure: DataStoreExposure.Private,
    estimatedRecords: null,
    isProduction: false,
    hasRecentSecurityActivity: false,
    dataTypeIds: ["email-address"],
    checks: [],
    existingIssues: [],
    now: NOW,
    ...overrides,
  });
}

describe("a telemetry issue whose data only a scrub rule hides", () => {
  test("resolves as Contained at ingest - amber, not fixed - and says the code still writes it", async () => {
    const issue: DataSecurityIssue = issueOf({
      checkId: SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
      status: DataSecurityIssueStatus.Open,
    });

    const output: ReconcileStoreOutput = await reconcile({
      checks: [
        check(
          SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
          DataSecurityCheckStatus.Pass,
        ),
      ],
      existingIssues: [issue],
      containedCheckIds: new Set([SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID]),
    });

    expect(writes()[0]!.data).toMatchObject({
      status: DataSecurityIssueStatus.Resolved,
      resolution: DataSecurityIssueResolution.ContainedAtIngest,
      resolutionDetails: { at: NOW.toISOString() },
      pendingResolution: null,
    });
    expect(feeds()[0]).toMatchObject({
      eventType: DataSecurityIssueFeedEventType.Contained,
      displayColor: Yellow500,
    });
    expect(feeds()[0]!.feedInfoInMarkdown).toContain(
      "Contained at ingest, not fixed",
    );
    expect(feeds()[0]!.feedInfoInMarkdown).toContain(
      "the code still writes it",
    );
    expect(output.closed).toEqual([
      {
        issueId: issue.id,
        why: "a scrub rule hides its data at ingest, though the code still writes it",
      },
    ]);
  });

  test("a telemetry check whose data stopped arriving, with no rule, passed: Check passed", async () => {
    await reconcile({
      checks: [
        check(SECRETS_IN_TELEMETRY_CHECK_ID, DataSecurityCheckStatus.Pass),
      ],
      existingIssues: [
        issueOf({
          checkId: SECRETS_IN_TELEMETRY_CHECK_ID,
          status: DataSecurityIssueStatus.Open,
        }),
      ],
      // The store's other check is contained: not this one.
      containedCheckIds: new Set([SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID]),
    });

    expect(writes()[0]!.data["resolution"]).toBe(
      DataSecurityIssueResolution.CheckPassed,
    );
    expect(feeds()[0]!.eventType).toBe(DataSecurityIssueFeedEventType.Resolved);
  });
});

describe("a response action's change", () => {
  test("resolves the issue as Fixed from here, with the action and who ran it, once its check passes", async () => {
    const userId: string = OWNER_ID.toString();

    await reconcile({
      checks: [check("public-read", DataSecurityCheckStatus.Pass)],
      existingIssues: [
        issueOf({
          checkId: "public-read",
          status: DataSecurityIssueStatus.Open,
          pendingResolution: {
            resolution: DataSecurityIssueResolution.FixedFromHere,
            responseAction: DataSecurityResponseAction.BlockPublicAccess,
            at: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
            userId,
          },
        }),
      ],
    });

    expect(writes()[0]!.data).toMatchObject({
      resolution: DataSecurityIssueResolution.FixedFromHere,
      resolutionDetails: {
        at: NOW.toISOString(),
        responseAction: DataSecurityResponseAction.BlockPublicAccess,
        userId,
      },
      pendingResolution: null,
    });
    expect(feeds()[0]!.feedInfoInMarkdown).toBe(
      "Resolved: fixed from here. **Block public access** changed the store, and its check passes now.",
    );
  });

  test("one made more than a week before the check passed explains nothing: Check passed", async () => {
    await reconcile({
      checks: [check("public-read", DataSecurityCheckStatus.Pass)],
      existingIssues: [
        issueOf({
          checkId: "public-read",
          status: DataSecurityIssueStatus.Open,
          pendingResolution: {
            resolution: DataSecurityIssueResolution.FixedFromHere,
            responseAction: DataSecurityResponseAction.BlockPublicAccess,
            at: new Date(NOW.getTime() - 8 * DAY).toISOString(),
          },
        }),
      ],
    });

    expect(writes()[0]!.data["resolution"]).toBe(
      DataSecurityIssueResolution.CheckPassed,
    );
  });

  test("Fix it from here marks the store's open issues it fixes, and only those", async () => {
    const fixes: DataSecurityIssue = issueOf({
      checkId: "public-read",
      status: DataSecurityIssueStatus.Open,
    });
    const other: DataSecurityIssue = issueOf({
      checkId: "access-not-logged",
      status: DataSecurityIssueStatus.Open,
    });
    const findBy: jest.SpyInstance = jest
      .spyOn(DataSecurityIssueService, "findBy")
      .mockResolvedValue([fixes, other] as never);
    const hookFree: jest.SpyInstance = jest
      .spyOn(DataSecurityIssueService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined as never);
    const store: DataStore = new DataStore(STORE_ID);

    store.kind = DataStoreKind.AwsS3Bucket;

    await DataSecurityResponse.markIssuesFixedFromHere({
      projectId: PROJECT_ID,
      store,
      action: DataSecurityResponseAction.BlockPublicAccess,
      userId: OWNER_ID,
      now: NOW,
    });

    expect(
      (findBy.mock.calls[0]![0] as { query: JSONObject }).query,
    ).toMatchObject({
      projectId: PROJECT_ID,
      dataStoreId: STORE_ID,
      status: DataSecurityIssueStatus.Open,
    });
    expect(hookFree).toHaveBeenCalledTimes(1);
    expect(hookFree.mock.calls[0]![0]).toEqual({
      id: fixes.id,
      data: {
        pendingResolution: {
          resolution: DataSecurityIssueResolution.FixedFromHere,
          responseAction: DataSecurityResponseAction.BlockPublicAccess,
          at: NOW.toISOString(),
          userId: OWNER_ID.toString(),
        },
      },
    });
  });
});

describe("a leak that came back after its verified fix", () => {
  const regression: JSONObject = {
    regression: {
      at: NOW.toISOString(),
      version: "2.5.0",
      fix: FIX,
    },
  } as unknown as JSONObject;

  test("opens again with the version that brought it back, even while a kept rule hides it", async () => {
    const issue: DataSecurityIssue = issueOf({
      checkId: SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
      status: DataSecurityIssueStatus.Resolved,
      resolution: DataSecurityIssueResolution.FixedInCode,
      resolutionDetails: { at: NOW.toISOString(), fix: FIX, ...regression },
    });

    const output: ReconcileStoreOutput = await reconcile({
      checks: [
        check(
          SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
          DataSecurityCheckStatus.Pass,
        ),
      ],
      existingIssues: [issue],
      containedCheckIds: new Set([SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID]),
    });

    expect(writes()[0]!.data).toMatchObject({
      status: DataSecurityIssueStatus.Open,
      resolution: null,
      pendingResolution: null,
      resolvedAt: null,
      reopenCount: 1,
    });
    // It keeps which version brought it back, for its page.
    expect(
      readDataSecurityIssueResolutionDetails(
        writes()[0]!.data["resolutionDetails"],
      ).regression?.version,
    ).toBe("2.5.0");
    expect(feeds()[0]).toMatchObject({
      eventType: DataSecurityIssueFeedEventType.FixRegressed,
      displayColor: Red500,
    });
    expect(feeds()[0]!.feedInfoInMarkdown).toBe(
      "Opened again. The leak came back in version 2.5.0, after pull request [#482](https://github.com/acme/checkout/pull/482) fixed it in version 2.4.1. The scrub rule kept after the fix hides it at ingest, so nothing new is stored, but the code writes it again.",
    );
    // Opened again as any issue: its alert and owners hear of it.
    expect(
      output.opened.map((opened: { issueId: ObjectID }) => {
        return opened.issueId;
      }),
    ).toEqual([issue.id]);
  });

  test("open again and only hidden at ingest, it stays open, counted", async () => {
    const output: ReconcileStoreOutput = await reconcile({
      checks: [
        check(
          SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
          DataSecurityCheckStatus.Pass,
        ),
      ],
      existingIssues: [
        issueOf({
          checkId: SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
          status: DataSecurityIssueStatus.Open,
          resolutionDetails: regression,
        }),
      ],
      containedCheckIds: new Set([SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID]),
    });

    expect(updateSpy).not.toHaveBeenCalled();
    expect(feedSpy).not.toHaveBeenCalled();
    expect(output.openIssueCount).toBe(1);
    expect(output.resolvedCount).toBe(0);
  });

  test("a check that fails again names the version too", async () => {
    await reconcile({
      checks: [
        check(
          SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
          DataSecurityCheckStatus.Fail,
          SecuritySeverity.High,
        ),
      ],
      existingIssues: [
        issueOf({
          checkId: SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
          status: DataSecurityIssueStatus.Resolved,
          resolution: DataSecurityIssueResolution.FixedInCode,
          resolutionDetails: { fix: FIX, ...regression },
        }),
      ],
    });

    expect(feeds()[0]!.feedInfoInMarkdown).toContain(
      "Opened again. The leak came back in version 2.5.0",
    );
  });

  test("a verified fix's check failing again, for another reason, names the pull request", async () => {
    await reconcile({
      checks: [
        check(
          "public-read",
          DataSecurityCheckStatus.Fail,
          SecuritySeverity.High,
        ),
      ],
      existingIssues: [
        issueOf({
          checkId: "public-read",
          status: DataSecurityIssueStatus.Resolved,
          resolution: DataSecurityIssueResolution.FixedInInfrastructureCode,
          resolutionDetails: { fix: { ...FIX, version: undefined } } as never,
        }),
      ],
    });

    expect(feeds()[0]!.feedInfoInMarkdown).toBe(
      "The check failed again after the issue was fixed in pull request [#482](https://github.com/acme/checkout/pull/482), so it is open again. Evidence of public-read.",
    );
    expect(writes()[0]!.data["resolutionDetails"]).toBeNull();
  });
});

describe("a code fix production proved (Fixed in code)", () => {
  test("its open issue resolves with the pull request, the version and the time, its findings fixed, the kept rule named", async () => {
    const open: DataSecurityIssue = issueOf({
      checkId: SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
      status: DataSecurityIssueStatus.Open,
    });
    const contained: DataSecurityIssue = issueOf({
      checkId: SECRETS_IN_TELEMETRY_CHECK_ID,
      status: DataSecurityIssueStatus.Resolved,
      resolution: DataSecurityIssueResolution.ContainedAtIngest,
    });
    const accepted: DataSecurityIssue = issueOf({
      checkId: "public-read",
      status: DataSecurityIssueStatus.Accepted,
    });

    jest
      .spyOn(DataSecurityIssueService, "findBy")
      .mockResolvedValue([open, contained, accepted] as never);
    const findingsSpy: jest.SpyInstance = jest
      .spyOn(DataStoreFindingService, "updateBy")
      .mockResolvedValue(undefined as never);
    const findingId: ObjectID = ObjectID.generate();

    const written: Array<ObjectID> =
      await DataSecurityIssueResolutions.markFixedInCode({
        projectId: PROJECT_ID,
        issueIds: [open.id!, contained.id!, accepted.id!],
        fix: FIX,
        verifiedAt: NOW,
        keptRules: [
          {
            id: ObjectID.generate().toString(),
            signal: "log",
            name: "Data Security: Email address in log attributes of checkout",
          },
        ],
        findingIds: [findingId],
      });

    // The accepted one is a person's: left alone.
    expect(written.map(String)).toEqual([open.id!, contained.id!].map(String));
    expect(writes()[0]!.data).toMatchObject({
      status: DataSecurityIssueStatus.Resolved,
      resolution: DataSecurityIssueResolution.FixedInCode,
      resolvedAt: NOW,
      pendingResolution: null,
    });
    // A contained one is upgraded: it resolved when it did.
    expect(writes()[1]!.data["resolvedAt"]).toBeUndefined();
    expect(writes()[1]!.data["resolution"]).toBe(
      DataSecurityIssueResolution.FixedInCode,
    );

    const details: JSONObject = writes()[0]!.data[
      "resolutionDetails"
    ] as JSONObject;

    expect(readDataSecurityIssueResolutionDetails(details)).toMatchObject({
      at: NOW.toISOString(),
      fix: { number: 482, version: "2.4.1" },
      scrubRules: [{ signal: "log" }],
    });

    // Its findings stop counting: old data waiting for its retention.
    expect(findingsSpy.mock.calls[0]![0]).toMatchObject({
      data: { fixedAt: NOW },
    });
    // Only the issue that was open closes its alert and its proposals.
    expect(
      (alertSpy.mock.calls[0]![0] as { issues: Array<{ issueId: ObjectID }> })
        .issues,
    ).toEqual([
      { issueId: open.id, why: "its fix was verified in production" },
    ]);
    expect(closedSpy.mock.calls[0]![0]).toMatchObject({
      issueIds: [open.id],
      checkPassed: true,
    });

    // "Fixed in pull request #n, deployed in version x, verified at time t", on both timelines.
    expect(feeds()).toHaveLength(2);
    expect(feeds()[0]).toMatchObject({
      eventType: DataSecurityIssueFeedEventType.FixVerified,
      displayColor: Green500,
    });
    expect(feeds()[0]!.feedInfoInMarkdown).toContain(
      "Fixed in pull request [#482](https://github.com/acme/checkout/pull/482), deployed in version 2.4.1, verified at ",
    );
    expect(feeds()[0]!.feedInfoInMarkdown).toContain(
      "**Data Security: Email address in log attributes of checkout**, is kept",
    );
    expect(storeFeedSpy.mock.calls[0]![0]).toMatchObject({
      dataStoreId: STORE_ID,
      dataStoreFeedEventType: DataStoreFeedEventType.IssueFixVerified,
    });
    expect(queueDataSecurityEvaluation).toHaveBeenCalledWith(PROJECT_ID);
  });

  test("the line names a commit when the deploy named no version", () => {
    expect(
      describeFixedInCode({
        fix: { ...FIX, version: undefined, commitSha: "1a2b3c4d5e6f" },
        verifiedAt: NOW,
      }).toString(),
    ).toContain("deployed in commit `1a2b3c4`");
  });
});

describe("the leak came back after its verified fix", () => {
  test("the issue keeps the version, its findings count again, and the project is evaluated", async () => {
    const issue: DataSecurityIssue = issueOf({
      checkId: SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
      status: DataSecurityIssueStatus.Resolved,
      resolution: DataSecurityIssueResolution.FixedInCode,
      resolutionDetails: { at: NOW.toISOString(), fix: FIX } as never,
    });
    const hookFree: jest.SpyInstance = jest
      .spyOn(DataSecurityIssueService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined as never);
    const findingsSpy: jest.SpyInstance = jest
      .spyOn(DataStoreFindingService, "updateBy")
      .mockResolvedValue(undefined as never);

    jest
      .spyOn(DataSecurityIssueService, "findBy")
      .mockResolvedValue([issue] as never);

    await DataSecurityIssueResolutions.markCameBack({
      projectId: PROJECT_ID,
      issue,
      regression: { at: NOW.toISOString(), version: "2.5.0", fix: FIX },
      findingIds: [ObjectID.generate()],
    });

    const details: JSONObject = (
      hookFree.mock.calls[0]![0] as { data: JSONObject }
    ).data["resolutionDetails"] as JSONObject;

    expect(readDataSecurityIssueResolutionDetails(details)).toMatchObject({
      fix: { number: 482 },
      regression: { version: "2.5.0" },
    });
    expect(findingsSpy.mock.calls[0]![0]).toMatchObject({
      data: { fixedAt: null },
    });
    expect(storeFeedSpy.mock.calls[0]![0]).toMatchObject({
      dataStoreFeedEventType: DataStoreFeedEventType.IssueFixRegressed,
    });
    expect(queueDataSecurityEvaluation).toHaveBeenCalledWith(PROJECT_ID);
  });

  test("says which version brought it back, and what had fixed it", () => {
    expect(
      describeRegression({
        at: NOW.toISOString(),
        version: "2.5.0",
        fix: FIX,
      }).toString(),
    ).toBe(
      "The leak came back in version 2.5.0, after pull request [#482](https://github.com/acme/checkout/pull/482) fixed it in version 2.4.1.",
    );
    expect(describeRegression({ at: NOW.toISOString() }).toString()).toBe(
      "The leak came back after its fix was verified.",
    );
  });
});

describe("a pull request as a resolution keeps it", () => {
  test("its row, its task, its number, its address, its repository and the deploy", () => {
    const pullRequest: AIAgentTaskPullRequest = new AIAgentTaskPullRequest(
      PULL_REQUEST_ID,
    );

    pullRequest.pullRequestNumber = 482;
    pullRequest.pullRequestUrl = URL.fromString(
      "https://github.com/acme/checkout/pull/482",
    );
    pullRequest.repoOrganizationName = "acme";
    pullRequest.repoName = "checkout";
    pullRequest.mergedAt = new Date(NOW.getTime() - DAY);

    const taskId: ObjectID = ObjectID.generate();

    expect(
      getResolutionFixOf({
        pullRequest,
        taskId,
        version: "2.4.1",
        deployedAt: NOW,
      }),
    ).toEqual({
      pullRequestId: PULL_REQUEST_ID.toString(),
      taskId: taskId.toString(),
      number: 482,
      url: "https://github.com/acme/checkout/pull/482",
      repository: "acme/checkout",
      mergedAt: new Date(NOW.getTime() - DAY).toISOString(),
      version: "2.4.1",
      deployedAt: NOW.toISOString(),
    });
  });
});

describe("merged, not applied: told once, to the owners and the author", () => {
  function user(id: ObjectID, email: string): User {
    const read: User = new User(id);

    read.email = email as never;
    read.name = "A person" as never;

    return read;
  }

  test("each owner hears of their stores, the author of every store, and the timelines say who was emailed", async () => {
    const otherStore: ObjectID = ObjectID.generate();
    const first: ObjectID = ObjectID.generate();
    const second: ObjectID = ObjectID.generate();
    const owner: User = user(OWNER_ID, "owner@acme.test");
    const author: User = user(AUTHOR_ID, "author@acme.test");
    const mail: jest.SpyInstance = jest
      .spyOn(MailService, "sendMail")
      .mockResolvedValue(undefined as never);

    jest
      .spyOn(DataStoreService, "findBy")
      .mockResolvedValue([
        Object.assign(new DataStore(STORE_ID), { name: "prod-assets" }),
        Object.assign(new DataStore(otherStore), { name: "prod-logs" }),
      ] as never);
    jest
      .spyOn(DataSecurityIssueService, "getIssueLinkInDashboard")
      .mockImplementation((async (
        projectId: ObjectID,
        issueId: ObjectID,
      ): Promise<URL> => {
        return URL.fromString(
          `https://oneuptime.test/${projectId.toString()}/data-security/issues/${issueId.toString()}`,
        );
      }) as never);
    jest
      .spyOn(DataSecurityIntegrations, "getOwnersToNotify")
      .mockImplementation((async (data: {
        dataStoreId: ObjectID;
      }): Promise<Array<User>> => {
        // The first store has an owner; the second has none.
        return data.dataStoreId.toString() === STORE_ID.toString()
          ? [owner]
          : [];
      }) as never);
    jest.spyOn(UserService, "findOneById").mockResolvedValue(author as never);
    jest.spyOn(DataSecurityIssueService, "findBy").mockResolvedValue([
      Object.assign(new DataSecurityIssue(first), {
        dataStoreId: STORE_ID,
        title: "Anyone on the internet can read it",
      }),
      Object.assign(new DataSecurityIssue(second), {
        dataStoreId: otherStore,
        title: "Access to it is not logged",
      }),
    ] as never);

    const emailed: number = await DataSecurityFixNotAppliedNotice.send({
      projectId: PROJECT_ID,
      fix: { ...FIX, version: undefined },
      issues: [
        { issueId: first, dataStoreId: STORE_ID, checkId: "public-read" },
        {
          issueId: second,
          dataStoreId: otherStore,
          checkId: "access-not-logged",
        },
      ],
      authorUserId: AUTHOR_ID,
    });

    expect(emailed).toBe(2);

    const sent: Array<{ toEmail: string; vars: { message: string } }> =
      mail.mock.calls.map((call: Array<unknown>) => {
        return call[0] as { toEmail: string; vars: { message: string } };
      });

    expect(
      sent.map((one: { toEmail: string }) => {
        return one.toEmail.toString();
      }),
    ).toEqual(["owner@acme.test", "author@acme.test"]);
    // The owner hears of the store they own; the author of both.
    expect(sent[0]!.vars.message).toContain("prod-assets");
    expect(sent[0]!.vars.message).not.toContain("prod-logs");
    expect(sent[1]!.vars.message).toContain("prod-assets");
    expect(sent[1]!.vars.message).toContain("prod-logs");
    expect(sent[1]!.vars.message).toContain(
      "An apply is usually what is missing",
    );

    // Each issue's timeline says so, and its store's.
    expect(feeds()).toHaveLength(2);
    expect(feeds()[0]!.eventType).toBe(
      DataSecurityIssueFeedEventType.FixNotApplied,
    );
    expect(feeds()[0]!.feedInfoInMarkdown).toContain(
      "Merged, not applied: pull request [#482](https://github.com/acme/checkout/pull/482) merged a day ago",
    );
    expect(feeds()[0]!.feedInfoInMarkdown).toContain(
      "2 people were emailed: the store's owners and the pull request's author.",
    );
    expect(
      storeFeedSpy.mock.calls.map((call: Array<unknown>) => {
        return (call[0] as { dataStoreFeedEventType: string })
          .dataStoreFeedEventType;
      }),
    ).toEqual([
      DataStoreFeedEventType.IssueFixNotApplied,
      DataStoreFeedEventType.IssueFixNotApplied,
    ]);
  });

  test("with nobody to email, the timeline says so", () => {
    expect(
      describeNotAppliedLine({ fix: FIX, emailed: 0 }).toString(),
    ).toContain(
      "Nobody was emailed: the store has no owner, and nobody asked for the pull request.",
    );
  });

  test("its subject names the pull request, and its body every store with its check and its issue", () => {
    expect(getFixNotAppliedSubject({ fix: FIX })).toBe(
      "Data Security: pull request #482 merged, but its change was not applied",
    );
    expect(getFixNotAppliedSubject({ fix: { pullRequestId: "x" } })).toBe(
      "Data Security: a fix merged, but its change was not applied",
    );

    const body: string = buildFixNotAppliedMarkdown({
      fix: FIX,
      stores: [
        {
          issueId: ObjectID.generate(),
          dataStoreId: STORE_ID,
          storeName: "prod-*assets*",
          checkTitle: "Anyone on the internet can read it",
          issueLink: URL.fromString("https://oneuptime.test/issue/1"),
        },
      ],
      moreCount: 3,
    }).toString();

    // A name from a cloud is placed as text, never as markup.
    expect(body).toContain("prod-\\*assets\\*");
    expect(body).toContain("[Open the issue](https://oneuptime.test/issue/1)");
    expect(body).toContain("And 3 more stores the pull request is for.");
  });
});
