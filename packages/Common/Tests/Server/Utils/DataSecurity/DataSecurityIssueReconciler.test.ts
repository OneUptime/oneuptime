import DataSecurityIssueReconciler, {
  getIssueKey,
  ReconcileStoreInput,
  ReconcileStoreOutput,
} from "../../../../Server/Utils/DataSecurity/DataSecurityIssueReconciler";
import DataSecurityIssueFeedService from "../../../../Server/Services/DataSecurityIssueFeedService";
import DataSecurityIssueService from "../../../../Server/Services/DataSecurityIssueService";
import CreateBy from "../../../../Server/Types/Database/CreateBy";
import logger from "../../../../Server/Utils/Logger";
import DataSecurityIssue from "../../../../Models/DatabaseModels/DataSecurityIssue";
import { DataSecurityIssueFeedEventType } from "../../../../Models/DatabaseModels/DataSecurityIssueFeed";
import {
  Gray500,
  Green500,
  Orange500,
  Red500,
} from "../../../../Types/BrandColors";
import Color from "../../../../Types/Color";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import SecuritySeverity from "../../../../Types/SecuritySeverity";
import DataSecurityIssueStatus from "../../../../Types/DataSecurity/DataSecurityIssueStatus";
import {
  DataSecurityCheckInfo,
  DataSecurityCheckStatus,
  EvaluatedCheck,
  FrameworkRequirementRef,
  getDataSecurityCheck,
} from "../../../../Types/DataSecurity/DataSecurityCheckCatalog";
import {
  getRiskScore,
  RiskScore,
} from "../../../../Types/DataSecurity/DataSecurityRisk";
import { DataStoreExposure } from "../../../../Types/DataSecurity/DataStorePosture";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A store's issues follow its checks (DataSecurityIssueReconciler): a
 * failing check with a severity opens one issue per store and check, a
 * passing one resolves it, a check that cannot tell leaves it alone, and a
 * person's verdict - accepted for a while, or not an issue at all - holds
 * until it runs out. Postgres is stood in for: the issue service's writes
 * and the timeline are recorded and read back here.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const STORE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const NOW: Date = new Date("2026-10-27T12:00:00.000Z");
const MINUTE_IN_MS: number = 60 * 1000;

interface FeedCall {
  projectId: ObjectID;
  dataSecurityIssueId: ObjectID;
  eventType: DataSecurityIssueFeedEventType;
  displayColor: Color;
  feedInfoInMarkdown: string;
}

interface WriteCall {
  id: ObjectID;
  data: JSONObject;
  props?: { isRoot?: boolean } | undefined;
}

let saved: Array<DataSecurityIssue> = [];
let createSpy: jest.SpyInstance;
let updateSpy: jest.SpyInstance;
let touchSpy: jest.SpyInstance;
let feedSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;

beforeEach(() => {
  saved = [];

  createSpy = jest
    .spyOn(DataSecurityIssueService, "create")
    .mockImplementation((async (
      createBy: CreateBy<DataSecurityIssue>,
    ): Promise<DataSecurityIssue> => {
      const issue: DataSecurityIssue = createBy.data;
      issue.id = ObjectID.generate();
      saved.push(issue);
      return issue;
    }) as never);
  updateSpy = jest
    .spyOn(DataSecurityIssueService, "updateOneById")
    .mockResolvedValue(undefined as never);
  touchSpy = jest
    .spyOn(DataSecurityIssueService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);
  feedSpy = jest
    .spyOn(DataSecurityIssueFeedService, "createDataSecurityIssueFeedItem")
    .mockResolvedValue(undefined);
  errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function checkInfo(id: string): DataSecurityCheckInfo {
  const info: DataSecurityCheckInfo | undefined = getDataSecurityCheck(id);

  if (!info) {
    throw new Error(`No check ${id} in the catalog.`);
  }

  return info;
}

function failing(
  checkId: string,
  severity: SecuritySeverity | null,
  evidence?: string,
): EvaluatedCheck {
  return {
    check: checkInfo(checkId),
    result: {
      status: DataSecurityCheckStatus.Fail,
      evidence: evidence === undefined ? `Evidence of ${checkId}.` : evidence,
    },
    severity,
  };
}

function withStatus(
  checkId: string,
  status: DataSecurityCheckStatus,
): EvaluatedCheck {
  return { check: checkInfo(checkId), result: { status }, severity: null };
}

function passing(checkId: string): EvaluatedCheck {
  return withStatus(checkId, DataSecurityCheckStatus.Pass);
}

function cannotTell(checkId: string): EvaluatedCheck {
  return withStatus(checkId, DataSecurityCheckStatus.Unknown);
}

function issueOf(data: {
  checkId: string | undefined;
  status: DataSecurityIssueStatus;
  severity?: SecuritySeverity | undefined;
  riskScore?: number | undefined;
  evidence?: string | undefined;
  lastDetectedAt?: Date | undefined;
  acceptedUntil?: Date | undefined;
  reopenCount?: number | undefined;
}): DataSecurityIssue {
  const issue: DataSecurityIssue = new DataSecurityIssue(ObjectID.generate());
  issue.projectId = PROJECT_ID;
  issue.dataStoreId = STORE_ID;

  if (data.checkId !== undefined) {
    issue.checkId = data.checkId;
  }

  issue.status = data.status;

  if (data.severity !== undefined) {
    issue.severity = data.severity;
  }

  if (data.riskScore !== undefined) {
    issue.riskScore = data.riskScore;
  }

  if (data.evidence !== undefined) {
    issue.evidence = data.evidence;
  }

  if (data.lastDetectedAt !== undefined) {
    issue.lastDetectedAt = data.lastDetectedAt;
  }

  if (data.acceptedUntil !== undefined) {
    issue.acceptedUntil = data.acceptedUntil;
  }

  if (data.reopenCount !== undefined) {
    issue.reopenCount = data.reopenCount;
  }

  return issue;
}

function storeInput(
  overrides: Partial<ReconcileStoreInput> = {},
): ReconcileStoreInput {
  return {
    projectId: PROJECT_ID,
    dataStoreId: STORE_ID,
    exposure: DataStoreExposure.Private,
    estimatedRecords: null,
    isProduction: false,
    hasRecentSecurityActivity: false,
    dataTypeIds: ["credit-card-number", "email-address"],
    checks: [],
    existingIssues: [],
    now: NOW,
    ...overrides,
  };
}

function riskOf(
  severity: SecuritySeverity,
  input: ReconcileStoreInput = storeInput(),
): RiskScore {
  return getRiskScore({
    severity,
    exposure: input.exposure,
    estimatedRecords: input.estimatedRecords,
    hasRecentSecurityActivity: input.hasRecentSecurityActivity,
    isProduction: input.isProduction,
  });
}

function minutesBefore(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * MINUTE_IN_MS);
}

function feeds(): Array<FeedCall> {
  return feedSpy.mock.calls.map((call: Array<unknown>): FeedCall => {
    return call[0] as FeedCall;
  });
}

function updates(): Array<WriteCall> {
  return updateSpy.mock.calls.map((call: Array<unknown>): WriteCall => {
    return call[0] as WriteCall;
  });
}

function touches(): Array<WriteCall> {
  return touchSpy.mock.calls.map((call: Array<unknown>): WriteCall => {
    return call[0] as WriteCall;
  });
}

function createdData(index: number = 0): DataSecurityIssue {
  return (createSpy.mock.calls[index]![0] as CreateBy<DataSecurityIssue>).data;
}

function reconcile(
  overrides: Partial<ReconcileStoreInput>,
): Promise<ReconcileStoreOutput> {
  return DataSecurityIssueReconciler.reconcileStore(storeInput(overrides));
}

describe("getIssueKey", () => {
  test("is the store and the check, so a store has one issue per check", () => {
    expect(getIssueKey(STORE_ID, "public-read")).toBe(
      "22222222-2222-4222-8222-222222222222|public-read",
    );
    expect(getIssueKey(STORE_ID, "public-read")).not.toBe(
      getIssueKey(STORE_ID, "public-write"),
    );
    expect(getIssueKey(ObjectID.generate(), "public-read")).not.toBe(
      getIssueKey(STORE_ID, "public-read"),
    );
  });
});

describe("a failing check with a severity opens an issue", () => {
  test("one issue, keyed by store and check, with what the check says", async () => {
    const output: ReconcileStoreOutput = await reconcile({
      checks: [
        failing(
          "public-read",
          SecuritySeverity.Critical,
          "The bucket policy grants s3:GetObject to *.",
        ),
      ],
    });

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(
      (createSpy.mock.calls[0]![0] as CreateBy<DataSecurityIssue>).props,
    ).toEqual({ isRoot: true });

    const issue: DataSecurityIssue = createdData();
    const check: DataSecurityCheckInfo = checkInfo("public-read");

    expect(issue.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(issue.dataStoreId?.toString()).toBe(STORE_ID.toString());
    expect(issue.issueKey).toBe(`${STORE_ID.toString()}|public-read`);
    expect(issue.checkId).toBe("public-read");
    expect(issue.checkGroup).toBe(check.group);
    expect(issue.title).toBe("Anyone on the internet can read it");
    expect(issue.evidence).toBe("The bucket policy grants s3:GetObject to *.");
    expect(issue.severity).toBe(SecuritySeverity.Critical);
    expect(issue.status).toBe(DataSecurityIssueStatus.Open);
    expect(issue.dataTypeIds).toEqual(["credit-card-number", "email-address"]);
    expect(issue.firstDetectedAt).toEqual(NOW);
    expect(issue.lastDetectedAt).toEqual(NOW);
    expect(issue.frameworks).toEqual(
      check.requirements.map((ref: FrameworkRequirementRef): JSONObject => {
        return { framework: ref.framework, requirement: ref.requirement };
      }),
    );
    expect(issue.frameworks).toContainEqual({
      framework: "PCI DSS",
      requirement: "7.2",
    });
    expect(output.openIssueCount).toBe(1);
    expect(output.resolvedCount).toBe(0);
  });

  test("its risk score is getRiskScore's, from the store's exposure, size, activity and environment", async () => {
    const input: ReconcileStoreInput = storeInput({
      exposure: DataStoreExposure.Public,
      estimatedRecords: 10_000_000,
      isProduction: true,
      hasRecentSecurityActivity: true,
      checks: [failing("public-read", SecuritySeverity.Critical)],
    });

    const output: ReconcileStoreOutput =
      await DataSecurityIssueReconciler.reconcileStore(input);
    const issue: DataSecurityIssue = createdData();
    const risk: RiskScore = riskOf(SecuritySeverity.Critical, input);

    // 75 Critical + 10 public + 6 ten million records + 5 activity + 4 production, held to 100.
    expect(risk.score).toBe(100);
    expect(issue.riskScore).toBe(risk.score);
    expect(issue.riskFactors).toEqual(risk.factors);
    expect(issue.riskFactors).toEqual([
      { label: "Critical severity", points: 75 },
      { label: "Exposure: Public", points: 10 },
      { label: "Number of records it holds", points: 6 },
      {
        label: "Security Operations saw activity on it this week",
        points: 5,
      },
      { label: "Production store", points: 4 },
    ]);
    expect(output.highestRiskScore).toBe(100);
  });

  test("a Medium issue on a store shared with other accounts scores 25 + 8 + its size", async () => {
    const input: ReconcileStoreInput = storeInput({
      exposure: DataStoreExposure.OtherAccounts,
      estimatedRecords: 1000,
      checks: [failing("access-not-logged", SecuritySeverity.Medium)],
    });

    await DataSecurityIssueReconciler.reconcileStore(input);

    // 25 Medium + 8 shared + round(6 x log10(1000) / 7) = 3.
    expect(createdData().riskScore).toBe(36);
    expect(createdData().riskScore).toBe(
      riskOf(SecuritySeverity.Medium, input).score,
    );
  });

  test("a store that is not production, not exposed and not busy gets only its severity's base", async () => {
    await reconcile({
      checks: [failing("no-owner", SecuritySeverity.Low)],
    });

    expect(createdData().riskScore).toBe(0);
    expect(createdData().riskFactors).toEqual([
      { label: "Low severity", points: 0 },
    ]);
  });

  test("is announced on its timeline: red for Critical and High, orange for Medium and Low", async () => {
    const expectations: Array<[SecuritySeverity, Color]> = [
      [SecuritySeverity.Critical, Red500],
      [SecuritySeverity.High, Red500],
      [SecuritySeverity.Medium, Orange500],
      [SecuritySeverity.Low, Orange500],
    ];

    for (const [severity, color] of expectations) {
      feedSpy.mockClear();
      createSpy.mockClear();

      const output: ReconcileStoreOutput = await reconcile({
        checks: [
          failing("not-encrypted-at-rest", severity, "Encryption is off."),
        ],
      });

      expect(feeds()).toHaveLength(1);

      const feed: FeedCall = feeds()[0]!;

      expect(feed.eventType).toBe(DataSecurityIssueFeedEventType.IssueOpened);
      expect(feed.displayColor).toBe(color);
      expect(feed.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(feed.dataSecurityIssueId.toString()).toBe(
        output.opened[0]!.issueId.toString(),
      );
      expect(feed.feedInfoInMarkdown).toBe(
        `**${severity}** issue opened: Its data is not encrypted at rest. Encryption is off.`,
      );
    }
  });

  test("is listed in `opened`, with the score it opened with", async () => {
    const output: ReconcileStoreOutput = await reconcile({
      exposure: DataStoreExposure.Public,
      checks: [failing("public-read", SecuritySeverity.Critical)],
    });

    expect(output.opened).toEqual([
      {
        issueId: saved[0]!.id,
        checkId: "public-read",
        title: "Anyone on the internet can read it",
        severity: SecuritySeverity.Critical,
        riskScore: 85,
      },
    ]);
    expect(output.highestSeverity).toBe(SecuritySeverity.Critical);
    expect(output.highestRiskScore).toBe(85);
  });

  test("keeps at most 500 characters of evidence and 50 data types", async () => {
    const dataTypeIds: Array<string> = [];

    for (let index: number = 0; index < 60; index++) {
      dataTypeIds.push(`custom-type-${index}`);
    }

    await reconcile({
      dataTypeIds,
      checks: [
        failing("secrets-stored", SecuritySeverity.High, "x".repeat(900)),
      ],
    });

    expect(createdData().evidence).toBe("x".repeat(500));
    expect(createdData().dataTypeIds).toEqual(dataTypeIds.slice(0, 50));
    expect(feeds()[0]!.feedInfoInMarkdown).toContain("x".repeat(500));
    expect(feeds()[0]!.feedInfoInMarkdown).not.toContain("x".repeat(501));
  });

  test("a check without evidence opens an issue with none", async () => {
    await reconcile({
      checks: [
        {
          check: checkInfo("no-owner"),
          result: { status: DataSecurityCheckStatus.Fail },
          severity: SecuritySeverity.Medium,
        },
      ],
    });

    expect(createdData().evidence).toBe("");
  });

  test("the evidence a cloud reported is written to the timeline as text, never as markup", async () => {
    await reconcile({
      checks: [
        failing(
          "shared-with-external-accounts",
          SecuritySeverity.High,
          "Shared with [the console](https://evil.example) *now*",
        ),
      ],
    });

    const markdown: string = feeds()[0]!.feedInfoInMarkdown;

    expect(markdown).not.toContain("[the console](https://evil.example)");
    expect(markdown).not.toContain("*now*");
    expect(markdown).toContain("\\[the console\\]");
    expect(markdown).toContain("\\*now\\*");
  });

  test("a failing check that is no issue at the store's sensitivity opens nothing", async () => {
    const output: ReconcileStoreOutput = await reconcile({
      checks: [failing("no-customer-managed-key", null)],
    });

    expect(createSpy).not.toHaveBeenCalled();
    expect(feedSpy).not.toHaveBeenCalled();
    expect(output).toEqual({
      opened: [],
      closed: [],
      resolvedCount: 0,
      openIssueCount: 0,
      highestSeverity: null,
      highestRiskScore: 0,
    });
  });

  test("dates the issue now when the caller gives no time", async () => {
    const clock: Date = new Date("2026-10-20T08:30:00.000Z");
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(clock);

    const input: ReconcileStoreInput = storeInput({
      checks: [failing("no-owner", SecuritySeverity.Low)],
    });
    delete input.now;

    await DataSecurityIssueReconciler.reconcileStore(input);

    expect(createdData().firstDetectedAt).toEqual(clock);
    expect(createdData().lastDetectedAt).toEqual(clock);
  });

  test("an issue the database returns without an id still counts, but is not announced", async () => {
    createSpy.mockImplementation((async (
      createBy: CreateBy<DataSecurityIssue>,
    ): Promise<DataSecurityIssue> => {
      return createBy.data;
    }) as never);

    const output: ReconcileStoreOutput = await reconcile({
      checks: [failing("no-owner", SecuritySeverity.Medium)],
    });

    expect(feedSpy).not.toHaveBeenCalled();
    expect(output.opened).toEqual([]);
    expect(output.openIssueCount).toBe(1);
    expect(output.highestSeverity).toBe(SecuritySeverity.Medium);
  });
});

describe("an open issue whose check still fails", () => {
  function stillOpen(lastDetectedAt: Date | undefined): DataSecurityIssue {
    return issueOf({
      checkId: "public-read",
      status: DataSecurityIssueStatus.Open,
      severity: SecuritySeverity.Critical,
      riskScore: riskOf(SecuritySeverity.Critical).score,
      evidence: "Evidence of public-read.",
      lastDetectedAt,
    });
  }

  test("with the same facts, it is only noted as seen - and at most hourly", async () => {
    const recent: DataSecurityIssue = stillOpen(minutesBefore(30));

    const quiet: ReconcileStoreOutput = await reconcile({
      checks: [failing("public-read", SecuritySeverity.Critical)],
      existingIssues: [recent],
    });

    expect(createSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(touchSpy).not.toHaveBeenCalled();
    expect(feedSpy).not.toHaveBeenCalled();
    expect(quiet.opened).toEqual([]);
    expect(quiet.openIssueCount).toBe(1);
    expect(quiet.highestSeverity).toBe(SecuritySeverity.Critical);

    const stale: DataSecurityIssue = stillOpen(minutesBefore(61));

    await reconcile({
      checks: [failing("public-read", SecuritySeverity.Critical)],
      existingIssues: [stale],
    });

    expect(touches()).toEqual([
      { id: stale.id, data: { lastDetectedAt: NOW } },
    ]);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(feedSpy).not.toHaveBeenCalled();
  });

  test("an hour to the minute is due; a minute less is not", async () => {
    await reconcile({
      checks: [failing("public-read", SecuritySeverity.Critical)],
      existingIssues: [stillOpen(minutesBefore(59))],
    });
    expect(touchSpy).not.toHaveBeenCalled();

    const due: DataSecurityIssue = stillOpen(minutesBefore(60));

    await reconcile({
      checks: [failing("public-read", SecuritySeverity.Critical)],
      existingIssues: [due],
    });
    expect(touches()).toEqual([{ id: due.id, data: { lastDetectedAt: NOW } }]);
  });

  test("an issue never noted as seen is noted now", async () => {
    const never: DataSecurityIssue = stillOpen(undefined);

    await reconcile({
      checks: [failing("public-read", SecuritySeverity.Critical)],
      existingIssues: [never],
    });

    expect(touches()).toEqual([
      { id: never.id, data: { lastDetectedAt: NOW } },
    ]);
  });

  test("a changed severity updates the issue and writes SeverityChanged", async () => {
    const issue: DataSecurityIssue = issueOf({
      checkId: "public-read",
      status: DataSecurityIssueStatus.Open,
      severity: SecuritySeverity.High,
      riskScore: riskOf(SecuritySeverity.High).score,
      evidence: "Evidence of public-read.",
      lastDetectedAt: minutesBefore(5),
    });

    const output: ReconcileStoreOutput = await reconcile({
      dataTypeIds: ["credit-card-number"],
      checks: [failing("public-read", SecuritySeverity.Critical)],
      existingIssues: [issue],
    });
    const risk: RiskScore = riskOf(SecuritySeverity.Critical);

    expect(updates()).toEqual([
      {
        id: issue.id,
        data: {
          severity: SecuritySeverity.Critical,
          riskScore: risk.score,
          riskFactors: risk.factors,
          evidence: "Evidence of public-read.",
          lastDetectedAt: NOW,
          dataTypeIds: ["credit-card-number"],
        },
        props: { isRoot: true },
      },
    ]);
    expect(feeds()).toHaveLength(1);
    expect(feeds()[0]).toMatchObject({
      eventType: DataSecurityIssueFeedEventType.SeverityChanged,
      displayColor: Red500,
    });
    expect(feeds()[0]!.dataSecurityIssueId.toString()).toBe(
      issue.id!.toString(),
    );
    expect(feeds()[0]!.feedInfoInMarkdown).toBe(
      "Severity changed from **High** to **Critical**, as the store's data or exposure changed.",
    );
    expect(touchSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
    expect(output.opened).toEqual([]);
    expect(output.openIssueCount).toBe(1);
    expect(output.highestSeverity).toBe(SecuritySeverity.Critical);
    expect(output.highestRiskScore).toBe(risk.score);
  });

  test("a lowered severity is written in orange", async () => {
    await reconcile({
      checks: [failing("public-read", SecuritySeverity.Medium)],
      existingIssues: [
        issueOf({
          checkId: "public-read",
          status: DataSecurityIssueStatus.Open,
          severity: SecuritySeverity.Critical,
          riskScore: 75,
          evidence: "Evidence of public-read.",
        }),
      ],
    });

    expect(feeds()[0]).toMatchObject({
      eventType: DataSecurityIssueFeedEventType.SeverityChanged,
      displayColor: Orange500,
      feedInfoInMarkdown:
        "Severity changed from **Critical** to **Medium**, as the store's data or exposure changed.",
    });
  });

  test("an issue with no severity recorded reads as 'none' in its timeline", async () => {
    await reconcile({
      checks: [failing("no-owner", SecuritySeverity.Low)],
      existingIssues: [
        issueOf({
          checkId: "no-owner",
          status: DataSecurityIssueStatus.Open,
          riskScore: 0,
          evidence: "Evidence of no-owner.",
        }),
      ],
    });

    expect(feeds()[0]!.feedInfoInMarkdown).toBe(
      "Severity changed from **none** to **Low**, as the store's data or exposure changed.",
    );
  });

  test("changed evidence, or a changed risk, updates the issue without a timeline entry", async () => {
    const evidenceChanged: DataSecurityIssue = issueOf({
      checkId: "public-read",
      status: DataSecurityIssueStatus.Open,
      severity: SecuritySeverity.Critical,
      riskScore: riskOf(SecuritySeverity.Critical).score,
      evidence: "The ACL grants READ to AllUsers.",
      lastDetectedAt: minutesBefore(1),
    });

    await reconcile({
      checks: [
        failing(
          "public-read",
          SecuritySeverity.Critical,
          "The policy grants * now.",
        ),
      ],
      existingIssues: [evidenceChanged],
    });

    expect(updates()).toHaveLength(1);
    expect(updates()[0]!.data["evidence"]).toBe("The policy grants * now.");
    expect(feedSpy).not.toHaveBeenCalled();

    updateSpy.mockClear();

    // The store became public: the same Critical check now scores 10 more.
    const riskChanged: DataSecurityIssue = issueOf({
      checkId: "public-read",
      status: DataSecurityIssueStatus.Open,
      severity: SecuritySeverity.Critical,
      riskScore: 75,
      evidence: "Evidence of public-read.",
      lastDetectedAt: minutesBefore(1),
    });

    const output: ReconcileStoreOutput = await reconcile({
      exposure: DataStoreExposure.Public,
      checks: [failing("public-read", SecuritySeverity.Critical)],
      existingIssues: [riskChanged],
    });

    expect(updates()).toHaveLength(1);
    expect(updates()[0]!.data["riskScore"]).toBe(85);
    expect(feedSpy).not.toHaveBeenCalled();
    expect(output.highestRiskScore).toBe(85);
  });
});

describe("a resolved issue whose check fails again", () => {
  test("opens again, counts the reopening and says so on its timeline", async () => {
    const issue: DataSecurityIssue = issueOf({
      checkId: "public-read",
      status: DataSecurityIssueStatus.Resolved,
      severity: SecuritySeverity.High,
      riskScore: 50,
      reopenCount: 2,
    });

    const output: ReconcileStoreOutput = await reconcile({
      checks: [
        failing("public-read", SecuritySeverity.Critical, "Public again."),
      ],
      existingIssues: [issue],
    });
    const risk: RiskScore = riskOf(SecuritySeverity.Critical);

    expect(createSpy).not.toHaveBeenCalled();
    expect(updates()).toEqual([
      {
        id: issue.id,
        data: {
          status: DataSecurityIssueStatus.Open,
          severity: SecuritySeverity.Critical,
          riskScore: risk.score,
          riskFactors: risk.factors,
          evidence: "Public again.",
          lastDetectedAt: NOW,
          resolvedAt: null,
          acceptedReason: null,
          acceptedUntil: null,
          reopenCount: 3,
        },
        props: { isRoot: true },
      },
    ]);
    expect(feeds()).toHaveLength(1);
    expect(feeds()[0]).toMatchObject({
      eventType: DataSecurityIssueFeedEventType.Reopened,
      displayColor: Red500,
      feedInfoInMarkdown:
        "The check failed again after the issue was resolved, so it is open again. Public again.",
    });
    expect(output.opened).toEqual([
      {
        issueId: issue.id,
        checkId: "public-read",
        title: "Anyone on the internet can read it",
        severity: SecuritySeverity.Critical,
        riskScore: risk.score,
      },
    ]);
    expect(output.openIssueCount).toBe(1);
  });

  test("an issue never reopened before counts its first reopening", async () => {
    await reconcile({
      checks: [failing("no-owner", SecuritySeverity.Low)],
      existingIssues: [
        issueOf({
          checkId: "no-owner",
          status: DataSecurityIssueStatus.Resolved,
        }),
      ],
    });

    expect(updates()[0]!.data["reopenCount"]).toBe(1);
    expect(feeds()[0]!.displayColor).toBe(Orange500);
  });
});

describe("an accepted issue whose check still fails", () => {
  test("opens again once its acceptance has run out, with AcceptanceExpired", async () => {
    const issue: DataSecurityIssue = issueOf({
      checkId: "access-not-logged",
      status: DataSecurityIssueStatus.Accepted,
      severity: SecuritySeverity.Medium,
      riskScore: 25,
      evidence: "Evidence of access-not-logged.",
      acceptedUntil: new Date(NOW.getTime() - 24 * 60 * MINUTE_IN_MS),
      reopenCount: 0,
    });

    const output: ReconcileStoreOutput = await reconcile({
      checks: [failing("access-not-logged", SecuritySeverity.Medium)],
      existingIssues: [issue],
    });

    expect(updates()).toHaveLength(1);
    expect(updates()[0]!.data).toMatchObject({
      status: DataSecurityIssueStatus.Open,
      acceptedReason: null,
      acceptedUntil: null,
      resolvedAt: null,
      reopenCount: 1,
      lastDetectedAt: NOW,
    });
    expect(feeds()).toEqual([
      {
        projectId: PROJECT_ID,
        dataSecurityIssueId: issue.id,
        eventType: DataSecurityIssueFeedEventType.AcceptanceExpired,
        displayColor: Orange500,
        feedInfoInMarkdown:
          "The accepted risk expired and the check still fails, so the issue is open again.",
      },
    ]);
    expect(
      output.opened.map((opened: { checkId: string }) => {
        return opened.checkId;
      }),
    ).toEqual(["access-not-logged"]);
    expect(output.openIssueCount).toBe(1);
  });

  test("an acceptance runs out at the moment it ends", async () => {
    const output: ReconcileStoreOutput = await reconcile({
      checks: [failing("access-not-logged", SecuritySeverity.Medium)],
      existingIssues: [
        issueOf({
          checkId: "access-not-logged",
          status: DataSecurityIssueStatus.Accepted,
          acceptedUntil: new Date(NOW.getTime()),
        }),
      ],
    });

    expect(feeds()[0]!.eventType).toBe(
      DataSecurityIssueFeedEventType.AcceptanceExpired,
    );
    expect(output.opened).toHaveLength(1);
  });

  test("still accepted, it stays accepted: noted as seen at most hourly, and not counted as open", async () => {
    const accepted: DataSecurityIssue = issueOf({
      checkId: "access-not-logged",
      status: DataSecurityIssueStatus.Accepted,
      severity: SecuritySeverity.Medium,
      acceptedUntil: new Date(NOW.getTime() + 24 * 60 * MINUTE_IN_MS),
      lastDetectedAt: minutesBefore(10),
    });

    const quiet: ReconcileStoreOutput = await reconcile({
      checks: [failing("access-not-logged", SecuritySeverity.High)],
      existingIssues: [accepted],
    });

    expect(updateSpy).not.toHaveBeenCalled();
    expect(touchSpy).not.toHaveBeenCalled();
    expect(feedSpy).not.toHaveBeenCalled();
    expect(quiet).toEqual({
      opened: [],
      closed: [],
      resolvedCount: 0,
      openIssueCount: 0,
      highestSeverity: null,
      highestRiskScore: 0,
    });

    accepted.lastDetectedAt = minutesBefore(120);

    await reconcile({
      checks: [failing("access-not-logged", SecuritySeverity.High)],
      existingIssues: [accepted],
    });

    expect(touches()).toEqual([
      { id: accepted.id, data: { lastDetectedAt: NOW } },
    ]);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("accepted with no end date stays accepted", async () => {
    await reconcile({
      checks: [failing("access-not-logged", SecuritySeverity.High)],
      existingIssues: [
        issueOf({
          checkId: "access-not-logged",
          status: DataSecurityIssueStatus.Accepted,
          lastDetectedAt: minutesBefore(5),
        }),
      ],
    });

    expect(updateSpy).not.toHaveBeenCalled();
    expect(feedSpy).not.toHaveBeenCalled();
  });
});

describe("an issue a person marked Not an issue", () => {
  function notAnIssue(lastDetectedAt?: Date): DataSecurityIssue {
    return issueOf({
      checkId: "secrets-stored",
      status: DataSecurityIssueStatus.NotAnIssue,
      severity: SecuritySeverity.High,
      riskScore: 50,
      lastDetectedAt,
    });
  }

  test("stays so when its check fails: noted as seen hourly, never reopened, never counted", async () => {
    const recent: ReconcileStoreOutput = await reconcile({
      checks: [failing("secrets-stored", SecuritySeverity.Critical)],
      existingIssues: [notAnIssue(minutesBefore(5))],
    });

    expect(updateSpy).not.toHaveBeenCalled();
    expect(touchSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
    expect(feedSpy).not.toHaveBeenCalled();
    expect(recent.openIssueCount).toBe(0);
    expect(recent.opened).toEqual([]);

    const old: DataSecurityIssue = notAnIssue(minutesBefore(90));

    await reconcile({
      checks: [failing("secrets-stored", SecuritySeverity.Critical)],
      existingIssues: [old],
    });

    expect(touches()).toEqual([{ id: old.id, data: { lastDetectedAt: NOW } }]);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("stays so when its check passes, cannot tell, no longer applies or no longer runs", async () => {
    for (const checks of [
      [passing("secrets-stored")],
      [cannotTell("secrets-stored")],
      [withStatus("secrets-stored", DataSecurityCheckStatus.NotApplicable)],
      [],
    ]) {
      const output: ReconcileStoreOutput = await reconcile({
        checks,
        existingIssues: [notAnIssue(minutesBefore(5))],
      });

      expect(output.resolvedCount).toBe(0);
      expect(output.openIssueCount).toBe(0);
    }

    expect(updateSpy).not.toHaveBeenCalled();
    expect(feedSpy).not.toHaveBeenCalled();
  });
});

describe("a check that cannot tell (Unknown)", () => {
  test("leaves an open issue open, and counts it with its stored severity and risk", async () => {
    const output: ReconcileStoreOutput = await reconcile({
      checks: [cannotTell("access-not-logged")],
      existingIssues: [
        issueOf({
          checkId: "access-not-logged",
          status: DataSecurityIssueStatus.Open,
          severity: SecuritySeverity.High,
          riskScore: 63,
        }),
      ],
    });

    expect(updateSpy).not.toHaveBeenCalled();
    expect(touchSpy).not.toHaveBeenCalled();
    expect(feedSpy).not.toHaveBeenCalled();
    expect(output).toEqual({
      opened: [],
      closed: [],
      resolvedCount: 0,
      openIssueCount: 1,
      highestSeverity: SecuritySeverity.High,
      highestRiskScore: 63,
    });
  });

  test("an open issue with no stored risk counts as 0", async () => {
    const output: ReconcileStoreOutput = await reconcile({
      checks: [cannotTell("access-not-logged")],
      existingIssues: [
        issueOf({
          checkId: "access-not-logged",
          status: DataSecurityIssueStatus.Open,
          severity: SecuritySeverity.Low,
        }),
      ],
    });

    expect(output.openIssueCount).toBe(1);
    expect(output.highestRiskScore).toBe(0);
  });

  test("never resolves an issue, whatever its status, and never opens one", async () => {
    for (const status of [
      DataSecurityIssueStatus.Open,
      DataSecurityIssueStatus.Accepted,
      DataSecurityIssueStatus.Resolved,
    ]) {
      const output: ReconcileStoreOutput = await reconcile({
        checks: [cannotTell("many-readers")],
        existingIssues: [issueOf({ checkId: "many-readers", status })],
      });

      expect(output.resolvedCount).toBe(0);
      expect(output.openIssueCount).toBe(
        status === DataSecurityIssueStatus.Open ? 1 : 0,
      );
    }

    await reconcile({ checks: [cannotTell("many-readers")] });

    expect(updateSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
    expect(feedSpy).not.toHaveBeenCalled();
  });
});

describe("a passing check", () => {
  test("resolves an open issue: Resolved, in green, because the check passes now", async () => {
    const issue: DataSecurityIssue = issueOf({
      checkId: "public-read",
      status: DataSecurityIssueStatus.Open,
      severity: SecuritySeverity.Critical,
      riskScore: 85,
    });

    const output: ReconcileStoreOutput = await reconcile({
      checks: [passing("public-read")],
      existingIssues: [issue],
    });

    expect(updates()).toEqual([
      {
        id: issue.id,
        data: {
          status: DataSecurityIssueStatus.Resolved,
          resolvedAt: NOW,
          acceptedReason: null,
          acceptedUntil: null,
        },
        props: { isRoot: true },
      },
    ]);
    expect(feeds()).toEqual([
      {
        projectId: PROJECT_ID,
        dataSecurityIssueId: issue.id,
        eventType: DataSecurityIssueFeedEventType.Resolved,
        displayColor: Green500,
        feedInfoInMarkdown: "Resolved: the check passes now.",
      },
    ]);
    expect(output).toEqual({
      opened: [],
      closed: [{ issueId: issue.id, why: "its check passes now" }],
      resolvedCount: 1,
      openIssueCount: 0,
      highestSeverity: null,
      highestRiskScore: 0,
    });
  });

  test("resolves an accepted issue too, and clears what was accepted", async () => {
    const accepted: DataSecurityIssue = issueOf({
      checkId: "access-not-logged",
      status: DataSecurityIssueStatus.Accepted,
      acceptedUntil: new Date(NOW.getTime() + 60 * MINUTE_IN_MS),
    });

    const output: ReconcileStoreOutput = await reconcile({
      checks: [passing("access-not-logged")],
      existingIssues: [accepted],
    });

    expect(updates()[0]!.data).toEqual({
      status: DataSecurityIssueStatus.Resolved,
      resolvedAt: NOW,
      acceptedReason: null,
      acceptedUntil: null,
    });
    expect(feeds()[0]!.displayColor).toBe(Green500);
    expect(output.resolvedCount).toBe(1);
  });

  test("leaves a resolved issue as it is", async () => {
    const output: ReconcileStoreOutput = await reconcile({
      checks: [passing("public-read")],
      existingIssues: [
        issueOf({
          checkId: "public-read",
          status: DataSecurityIssueStatus.Resolved,
        }),
      ],
    });

    expect(updateSpy).not.toHaveBeenCalled();
    expect(feedSpy).not.toHaveBeenCalled();
    expect(output.resolvedCount).toBe(0);
    expect(output.closed).toEqual([]);
  });

  test("a check that no longer applies resolves its issue as a pass does", async () => {
    const issue: DataSecurityIssue = issueOf({
      checkId: "production-data-in-non-production",
      status: DataSecurityIssueStatus.Open,
    });

    const output: ReconcileStoreOutput = await reconcile({
      checks: [
        withStatus(
          "production-data-in-non-production",
          DataSecurityCheckStatus.NotApplicable,
        ),
      ],
      existingIssues: [issue],
    });

    expect(updates()[0]!.data["status"]).toBe(DataSecurityIssueStatus.Resolved);
    expect(feeds()[0]!.displayColor).toBe(Green500);
    expect(output.resolvedCount).toBe(1);
  });

  test("a check that fails with no severity at the store's sensitivity resolves its open issue", async () => {
    const issue: DataSecurityIssue = issueOf({
      checkId: "no-customer-managed-key",
      status: DataSecurityIssueStatus.Open,
      severity: SecuritySeverity.Medium,
    });

    // The store was Restricted; it holds nothing that sensitive any more.
    const output: ReconcileStoreOutput = await reconcile({
      checks: [failing("no-customer-managed-key", null)],
      existingIssues: [issue],
    });

    expect(updates()[0]!.id.toString()).toBe(issue.id!.toString());
    expect(updates()[0]!.data["status"]).toBe(DataSecurityIssueStatus.Resolved);
    expect(output.resolvedCount).toBe(1);
    expect(output.openIssueCount).toBe(0);
  });
});

describe("an issue whose check no longer runs on the store", () => {
  test("resolves, in gray, saying the check no longer runs", async () => {
    const issue: DataSecurityIssue = issueOf({
      checkId: "weak-tls",
      status: DataSecurityIssueStatus.Open,
      severity: SecuritySeverity.Medium,
    });

    const output: ReconcileStoreOutput = await reconcile({
      checks: [passing("public-read")],
      existingIssues: [issue],
    });

    expect(updates()).toEqual([
      {
        id: issue.id,
        data: {
          status: DataSecurityIssueStatus.Resolved,
          resolvedAt: NOW,
          acceptedReason: null,
          acceptedUntil: null,
        },
        props: { isRoot: true },
      },
    ]);
    expect(feeds()).toEqual([
      {
        projectId: PROJECT_ID,
        dataSecurityIssueId: issue.id,
        eventType: DataSecurityIssueFeedEventType.Resolved,
        displayColor: Gray500,
        feedInfoInMarkdown:
          "Resolved: the check no longer runs on this store - it was turned off, or no longer applies.",
      },
    ]);
    expect(output.resolvedCount).toBe(1);
    expect(output.closed).toEqual([
      { issueId: issue.id, why: "its check no longer runs on the store" },
    ]);
  });

  test("resolves accepted issues too, and leaves resolved ones and Not an issue alone", async () => {
    const accepted: DataSecurityIssue = issueOf({
      checkId: "weak-tls",
      status: DataSecurityIssueStatus.Accepted,
    });
    const resolved: DataSecurityIssue = issueOf({
      checkId: "public-write",
      status: DataSecurityIssueStatus.Resolved,
    });
    const notAnIssue: DataSecurityIssue = issueOf({
      checkId: "secrets-stored",
      status: DataSecurityIssueStatus.NotAnIssue,
    });

    const output: ReconcileStoreOutput = await reconcile({
      checks: [],
      existingIssues: [accepted, resolved, notAnIssue],
    });

    expect(
      updates().map((write: WriteCall): string => {
        return write.id.toString();
      }),
    ).toEqual([accepted.id!.toString()]);
    expect(output.resolvedCount).toBe(1);
    expect(
      output.closed.map((closedIssue: { issueId: ObjectID }): string => {
        return closedIssue.issueId.toString();
      }),
    ).toEqual([accepted.id!.toString()]);
  });

  test("an issue with no check id is never matched, and never resolved", async () => {
    const output: ReconcileStoreOutput = await reconcile({
      checks: [passing("public-read")],
      existingIssues: [
        issueOf({ checkId: undefined, status: DataSecurityIssueStatus.Open }),
      ],
    });

    expect(updateSpy).not.toHaveBeenCalled();
    expect(output.resolvedCount).toBe(0);
  });
});

describe("the store's summary", () => {
  test("counts what is open, its worst severity and its highest risk", async () => {
    const stillFailing: DataSecurityIssue = issueOf({
      checkId: "access-not-logged",
      status: DataSecurityIssueStatus.Open,
      severity: SecuritySeverity.High,
      riskScore: riskOf(SecuritySeverity.High).score,
      evidence: "Evidence of access-not-logged.",
      lastDetectedAt: minutesBefore(1),
    });
    const cannotTellIssue: DataSecurityIssue = issueOf({
      checkId: "many-readers",
      status: DataSecurityIssueStatus.Open,
      severity: SecuritySeverity.Medium,
      riskScore: 30,
    });
    const nowPassing: DataSecurityIssue = issueOf({
      checkId: "not-encrypted-at-rest",
      status: DataSecurityIssueStatus.Open,
      severity: SecuritySeverity.Medium,
    });
    const gone: DataSecurityIssue = issueOf({
      checkId: "weak-tls",
      status: DataSecurityIssueStatus.Open,
      severity: SecuritySeverity.Low,
    });

    const output: ReconcileStoreOutput = await reconcile({
      checks: [
        failing("public-read", SecuritySeverity.Critical),
        failing("access-not-logged", SecuritySeverity.High),
        cannotTell("many-readers"),
        passing("not-encrypted-at-rest"),
        failing("no-customer-managed-key", null),
      ],
      existingIssues: [stillFailing, cannotTellIssue, nowPassing, gone],
    });

    expect(output.openIssueCount).toBe(3);
    expect(output.resolvedCount).toBe(2);
    expect(output.highestSeverity).toBe(SecuritySeverity.Critical);
    expect(output.highestRiskScore).toBe(75);
    expect(
      output.opened.map((opened: { checkId: string }) => {
        return opened.checkId;
      }),
    ).toEqual(["public-read"]);
  });

  test("is empty for a store with nothing wrong", async () => {
    const output: ReconcileStoreOutput = await reconcile({
      checks: [
        passing("public-read"),
        passing("no-owner"),
        cannotTell("weak-tls"),
      ],
    });

    expect(output).toEqual({
      opened: [],
      closed: [],
      resolvedCount: 0,
      openIssueCount: 0,
      highestSeverity: null,
      highestRiskScore: 0,
    });
  });

  test("whatever the mix of checks and issues, a person's verdict and an issue nobody can judge are never overturned", async () => {
    const random: SeededRandom = seededRandom(5309);
    const checkIds: Array<string> = [
      "public-read",
      "public-write",
      "not-encrypted-at-rest",
      "access-not-logged",
      "no-owner",
      "secrets-stored",
    ];
    const results: Array<DataSecurityCheckStatus | "missing"> = [
      DataSecurityCheckStatus.Pass,
      DataSecurityCheckStatus.Fail,
      DataSecurityCheckStatus.Unknown,
      DataSecurityCheckStatus.NotApplicable,
      "missing",
    ];
    const statuses: Array<DataSecurityIssueStatus | "none"> = [
      DataSecurityIssueStatus.Open,
      DataSecurityIssueStatus.Resolved,
      DataSecurityIssueStatus.Accepted,
      DataSecurityIssueStatus.NotAnIssue,
      "none",
    ];
    const severities: Array<SecuritySeverity | null> = [
      SecuritySeverity.Critical,
      SecuritySeverity.High,
      SecuritySeverity.Medium,
      SecuritySeverity.Low,
      null,
    ];

    for (let round: number = 0; round < 150; round++) {
      updateSpy.mockClear();
      createSpy.mockClear();
      feedSpy.mockClear();

      const checks: Array<EvaluatedCheck> = [];
      const issues: Array<DataSecurityIssue> = [];
      const statusOf: Map<string, DataSecurityIssueStatus> = new Map();
      let expectedResolved: number = 0;

      for (const checkId of checkIds) {
        const result: DataSecurityCheckStatus | "missing" =
          results[random(results.length)]!;
        const status: DataSecurityIssueStatus | "none" =
          statuses[random(statuses.length)]!;
        const severity: SecuritySeverity | null =
          severities[random(severities.length)]!;
        const acceptedUntil: Date = new Date(
          NOW.getTime() + (random(2) === 0 ? -1 : 1) * 60 * MINUTE_IN_MS,
        );

        if (result === DataSecurityCheckStatus.Fail) {
          checks.push(failing(checkId, severity));
        } else if (result !== "missing") {
          checks.push(withStatus(checkId, result));
        }

        if (status !== "none") {
          const issue: DataSecurityIssue = issueOf({
            checkId,
            status,
            severity: SecuritySeverity.Medium,
            riskScore: 25,
            acceptedUntil,
          });
          issues.push(issue);
          statusOf.set(issue.id!.toString(), status);

          const resolves: boolean =
            (status === DataSecurityIssueStatus.Open ||
              status === DataSecurityIssueStatus.Accepted) &&
            (result === "missing" ||
              result === DataSecurityCheckStatus.Pass ||
              result === DataSecurityCheckStatus.NotApplicable ||
              (result === DataSecurityCheckStatus.Fail && severity === null));

          if (resolves) {
            expectedResolved++;
          }
        }
      }

      const output: ReconcileStoreOutput = await reconcile({
        checks,
        existingIssues: issues,
      });

      for (const write of updates()) {
        const before: DataSecurityIssueStatus | undefined = statusOf.get(
          write.id.toString(),
        );

        // Not an issue is a person's verdict: nothing OneUptime runs changes it.
        expect(before).not.toBe(DataSecurityIssueStatus.NotAnIssue);

        if (write.data["status"] === DataSecurityIssueStatus.Resolved) {
          expect([
            DataSecurityIssueStatus.Open,
            DataSecurityIssueStatus.Accepted,
          ]).toContain(before);
        }
      }

      for (const feed of feeds()) {
        expect(statusOf.get(feed.dataSecurityIssueId.toString())).not.toBe(
          DataSecurityIssueStatus.NotAnIssue,
        );
      }

      expect(output.resolvedCount).toBe(expectedResolved);
      expect(
        feeds().filter((feed: FeedCall) => {
          return feed.eventType === DataSecurityIssueFeedEventType.Resolved;
        }),
      ).toHaveLength(expectedResolved);
      expect(output.openIssueCount).toBeGreaterThanOrEqual(
        output.opened.length,
      );
      expect(output.highestRiskScore).toBeGreaterThanOrEqual(0);
      expect(output.highestRiskScore).toBeLessThanOrEqual(100);
      expect(output.highestSeverity === null).toBe(output.openIssueCount === 0);
    }
  });
});

describe("one check that cannot be reconciled", () => {
  test("is logged, and the store's other checks are still reconciled", async () => {
    createSpy.mockImplementation((async (
      createBy: CreateBy<DataSecurityIssue>,
    ): Promise<DataSecurityIssue> => {
      if (createBy.data.checkId === "public-read") {
        throw new Error("Postgres went away");
      }

      createBy.data.id = ObjectID.generate();
      return createBy.data;
    }) as never);

    const output: ReconcileStoreOutput = await reconcile({
      checks: [
        failing("public-read", SecuritySeverity.Critical),
        failing("no-owner", SecuritySeverity.Low),
      ],
    });

    expect(createSpy).toHaveBeenCalledTimes(2);
    expect(
      output.opened.map((opened: { checkId: string }) => {
        return opened.checkId;
      }),
    ).toEqual(["no-owner"]);
    expect(output.openIssueCount).toBe(1);
    expect(output.highestSeverity).toBe(SecuritySeverity.Low);
    expect(errorSpy).toHaveBeenCalledWith(
      `DataSecurity: could not reconcile check public-read of store ${STORE_ID.toString()}:`,
    );
  });

  test("a failed reopening leaves the next issue's resolution in place", async () => {
    const reopening: DataSecurityIssue = issueOf({
      checkId: "public-read",
      status: DataSecurityIssueStatus.Resolved,
    });
    const resolving: DataSecurityIssue = issueOf({
      checkId: "no-owner",
      status: DataSecurityIssueStatus.Open,
    });

    updateSpy.mockImplementation((async (data: { id: ObjectID }) => {
      if (data.id.toString() === reopening.id!.toString()) {
        throw new Error("deadlock detected");
      }
    }) as never);

    const output: ReconcileStoreOutput = await reconcile({
      checks: [
        failing("public-read", SecuritySeverity.Critical),
        passing("no-owner"),
      ],
      existingIssues: [reopening, resolving],
    });

    expect(output.opened).toEqual([]);
    expect(output.resolvedCount).toBe(1);
    expect(
      feeds().map((feed: FeedCall) => {
        return feed.dataSecurityIssueId.toString();
      }),
    ).toEqual([resolving.id!.toString()]);
  });

  test("an issue of a check that no longer runs that cannot be resolved is logged, and neither the others nor what opened are lost", async () => {
    const first: DataSecurityIssue = issueOf({
      checkId: "weak-tls",
      status: DataSecurityIssueStatus.Open,
    });
    const second: DataSecurityIssue = issueOf({
      checkId: "public-write",
      status: DataSecurityIssueStatus.Open,
    });

    updateSpy.mockImplementation((async (data: { id: ObjectID }) => {
      if (data.id.toString() === first.id!.toString()) {
        throw new Error("Postgres went away");
      }
    }) as never);

    const output: ReconcileStoreOutput = await reconcile({
      checks: [failing("public-read", SecuritySeverity.Critical)],
      existingIssues: [first, second],
    });

    expect(
      output.opened.map((opened: { checkId: string }) => {
        return opened.checkId;
      }),
    ).toEqual(["public-read"]);
    expect(output.resolvedCount).toBe(1);
    expect(
      updates().map((write: WriteCall): string => {
        return write.id.toString();
      }),
    ).toEqual([first.id!.toString(), second.id!.toString()]);
    expect(errorSpy).toHaveBeenCalledWith(
      `DataSecurity: could not resolve the issue of check weak-tls of store ${STORE_ID.toString()}:`,
    );
  });
});
