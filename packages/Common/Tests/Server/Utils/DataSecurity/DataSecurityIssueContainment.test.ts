import { afterEach, describe, expect, test } from "@jest/globals";
import DataSecurityIssue from "../../../../Models/DatabaseModels/DataSecurityIssue";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import DataStoreFinding from "../../../../Models/DatabaseModels/DataStoreFinding";
import LogScrubRule from "../../../../Models/DatabaseModels/LogScrubRule";
import DataSecurityIssueService from "../../../../Server/Services/DataSecurityIssueService";
import DataStoreFindingService from "../../../../Server/Services/DataStoreFindingService";
import DataStoreService from "../../../../Server/Services/DataStoreService";
import LogScrubRuleService from "../../../../Server/Services/LogScrubRuleService";
import MetricPipelineRuleService from "../../../../Server/Services/MetricPipelineRuleService";
import ScrubRuleValueCountService from "../../../../Server/Services/ScrubRuleValueCountService";
import TraceScrubRuleService from "../../../../Server/Services/TraceScrubRuleService";
import DataSecurityIssueContainmentReader, {
  foldRuleCounts,
} from "../../../../Server/Utils/DataSecurity/DataSecurityIssueContainment";
import AiOutcomesBuilder from "../../../../Server/Utils/AI/Outcomes/AiOutcomesBuilder";
import logger from "../../../../Server/Utils/Logger";
import { AiOutcomesWeek } from "../../../../Types/AI/AiOutcomes";
import FixProductionCheck from "../../../../Types/AI/FixProductionCheck";
import FixProductionStatus from "../../../../Types/AI/FixProductionStatus";
import { DataSecurityIssueContainment } from "../../../../Types/DataSecurity/DataSecurityApiTypes";
import { SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID } from "../../../../Types/DataSecurity/DataSecurityCheckCatalog";
import DataConfidence from "../../../../Types/DataSecurity/DataConfidence";
import DataSecurityIssueResolution from "../../../../Types/DataSecurity/DataSecurityIssueResolution";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import LogScrubPatternType from "../../../../Types/Log/LogScrubPatternType";
import ObjectID from "../../../../Types/ObjectID";

/*
 * WHAT HIDES A TELEMETRY ISSUE'S DATA AT INGEST, AND WHETHER THE CODE STILL
 * WRITES IT (#10368): each rule hiding the issue's data, and what it
 * changed in the issue's service lately and since a verified code fix - and
 * AI Results' fix pull requests counted by kind.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "9d6b4a40-0000-4000-8000-000000000001",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "9d6b4a40-0000-4000-8000-000000000002",
);
const STORE_ID: ObjectID = new ObjectID("9d6b4a40-0000-4000-8000-000000000003");
const ISSUE_ID: ObjectID = new ObjectID("9d6b4a40-0000-4000-8000-000000000004");
const RULE_ID: string = "9d6b4a40-0000-4000-8000-000000000005";
const NOW: Date = new Date("2026-11-21T14:10:00.000Z");
const HOUR: number = 60 * 60 * 1000;

afterEach(() => {
  jest.restoreAllMocks();
});

function stubIssue(data: {
  resolution?: DataSecurityIssueResolution | undefined;
  resolutionDetails?: Record<string, unknown> | undefined;
}): void {
  const issue: DataSecurityIssue = Object.assign(
    new DataSecurityIssue(ISSUE_ID),
    {
      checkId: SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
      dataStoreId: STORE_ID,
      ...data,
    },
  );

  jest
    .spyOn(DataSecurityIssueService, "findOneBy")
    .mockResolvedValue(issue as never);
  jest.spyOn(DataStoreService, "findOneBy").mockResolvedValue(
    Object.assign(new DataStore(STORE_ID), {
      kind: DataStoreKind.TelemetryLogs,
      serviceId: SERVICE_ID,
    }) as never,
  );
  jest.spyOn(DataStoreFindingService, "findBy").mockResolvedValue([
    Object.assign(new DataStoreFinding(ObjectID.generate()), {
      dataTypeId: "email-address",
      location: "attributes.user.email",
      confidence: DataConfidence.High,
      matchCount: 4,
      isScrubbed: true,
    }),
  ] as never);
  jest.spyOn(LogScrubRuleService, "findBy").mockResolvedValue([
    Object.assign(new LogScrubRule(new ObjectID(RULE_ID)), {
      name: "Data Security: Email address in log attributes of checkout",
      patternType: LogScrubPatternType.Email,
      serviceId: SERVICE_ID,
    }),
  ] as never);
  jest.spyOn(TraceScrubRuleService, "findBy").mockResolvedValue([] as never);
  jest
    .spyOn(MetricPipelineRuleService, "findBy")
    .mockResolvedValue([] as never);
}

describe("an issue contained at ingest", () => {
  test("names the rule hiding its data, and what it changed in the issue's service in the last week", async () => {
    stubIssue({ resolution: DataSecurityIssueResolution.ContainedAtIngest });
    const read: jest.SpyInstance = jest
      .spyOn(ScrubRuleValueCountService, "readValueCounts")
      .mockResolvedValue([
        {
          scrubRuleId: RULE_ID,
          serviceId: SERVICE_ID.toString(),
          serviceVersion: "2.3.0",
          hour: new Date(NOW.getTime() - 5 * HOUR),
          valueCount: 1100,
          lastChangedAt: new Date(NOW.getTime() - 5 * HOUR),
        },
        {
          scrubRuleId: RULE_ID,
          serviceId: SERVICE_ID.toString(),
          serviceVersion: "2.3.1",
          hour: new Date(NOW.getTime() - HOUR),
          valueCount: 104,
          lastChangedAt: new Date(NOW.getTime() - HOUR + 60 * 1000),
        },
        // Another service the rule also hides: not this issue's.
        {
          scrubRuleId: RULE_ID,
          serviceId: ObjectID.generate().toString(),
          serviceVersion: "9.9.9",
          hour: new Date(NOW.getTime() - HOUR),
          valueCount: 50,
          lastChangedAt: NOW,
        },
      ]);

    const containment: DataSecurityIssueContainment | null =
      await DataSecurityIssueContainmentReader.read({
        projectId: PROJECT_ID,
        issueId: ISSUE_ID,
        props: { isRoot: true },
        now: NOW,
      });

    expect(containment).toEqual({
      days: 7,
      containedFindingCount: 1,
      rules: [
        {
          id: RULE_ID,
          signal: "log",
          name: "Data Security: Email address in log attributes of checkout",
          valuesChanged: 1204,
          lastChangedAt: new Date(
            NOW.getTime() - HOUR + 60 * 1000,
          ).toISOString(),
          lastChangedVersion: "2.3.1",
          isKept: false,
        },
      ],
    });
    expect(read.mock.calls[0]![0]).toMatchObject({
      projectId: PROJECT_ID,
      scrubRuleIds: [RULE_ID],
      byHour: true,
    });
  });

  test("a counter that cannot be read says nothing - never zero", async () => {
    stubIssue({ resolution: DataSecurityIssueResolution.ContainedAtIngest });
    jest
      .spyOn(ScrubRuleValueCountService, "readValueCounts")
      .mockRejectedValue(new Error("ClickHouse is down"));
    jest.spyOn(logger, "warn").mockImplementation(() => {
      return undefined as never;
    });

    const containment: DataSecurityIssueContainment | null =
      await DataSecurityIssueContainmentReader.read({
        projectId: PROJECT_ID,
        issueId: ISSUE_ID,
        props: { isRoot: true },
        now: NOW,
      });

    expect(containment?.rules[0]!.valuesChanged).toBeNull();
  });

  test("an issue the reader may not read is not found", async () => {
    jest
      .spyOn(DataSecurityIssueService, "findOneBy")
      .mockResolvedValue(null as never);

    expect(
      await DataSecurityIssueContainmentReader.read({
        projectId: PROJECT_ID,
        issueId: ISSUE_ID,
        props: { tenantId: PROJECT_ID, userId: ObjectID.generate() },
        now: NOW,
      }),
    ).toBeNull();
  });
});

describe("after a verified code fix", () => {
  test("the kept rule says what it changed since the fix: none, while it holds", async () => {
    const verifiedAt: Date = new Date(NOW.getTime() - 3 * 24 * HOUR);

    stubIssue({
      resolution: DataSecurityIssueResolution.FixedInCode,
      resolutionDetails: {
        at: verifiedAt.toISOString(),
        fix: { pullRequestId: ObjectID.generate().toString(), number: 482 },
        scrubRules: [{ id: RULE_ID, signal: "log", name: "Email rule" }],
      },
    });
    // Its findings were fixed: none is contained now.
    jest
      .spyOn(DataStoreFindingService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(ScrubRuleValueCountService, "readValueCounts")
      .mockResolvedValue([
        // Before the fix: the old version.
        {
          scrubRuleId: RULE_ID,
          serviceId: SERVICE_ID.toString(),
          serviceVersion: "2.3.1",
          hour: new Date(verifiedAt.getTime() - 30 * HOUR),
          valueCount: 300,
          lastChangedAt: new Date(verifiedAt.getTime() - 30 * HOUR),
        },
      ]);

    const containment: DataSecurityIssueContainment | null =
      await DataSecurityIssueContainmentReader.read({
        projectId: PROJECT_ID,
        issueId: ISSUE_ID,
        props: { isRoot: true },
        now: NOW,
      });

    expect(containment?.rules).toEqual([
      {
        id: RULE_ID,
        signal: "log",
        name: "Data Security: Email address in log attributes of checkout",
        valuesChanged: 300,
        lastChangedAt: new Date(verifiedAt.getTime() - 30 * HOUR).toISOString(),
        lastChangedVersion: "2.3.1",
        valuesChangedSinceFix: 0,
        isKept: true,
      },
    ]);
  });

  test("folds a rule's rows of one service, its latest change and version", () => {
    expect(
      foldRuleCounts({
        rows: [
          {
            scrubRuleId: RULE_ID,
            serviceId: SERVICE_ID.toString().toUpperCase(),
            serviceVersion: "a",
            valueCount: 2,
            lastChangedAt: new Date(1000),
          },
          {
            scrubRuleId: RULE_ID,
            serviceId: SERVICE_ID.toString(),
            serviceVersion: "b",
            valueCount: 3,
            lastChangedAt: new Date(2000),
          },
        ],
        serviceId: SERVICE_ID.toString(),
      }).get(RULE_ID),
    ).toEqual({
      valuesChanged: 5,
      lastChangedAt: new Date(2000),
      lastChangedVersion: "b",
    });
  });
});

describe("AI Results: the fix pull requests, counted by kind", () => {
  test("each kind apart - telemetry leaks fixed in code, stores fixed in infrastructure code - the most checked first", () => {
    const week: AiOutcomesWeek = {
      weekStart: "2026-11-16",
      pagesAvoided: 0,
      pagesHeld: 0,
      fixesVerified: 0,
      fixesChecked: 0,
      rootCausesConfirmed: 0,
      rootCausesJudged: 0,
      dataSecurityChangesProven: 0,
      dataSecurityChangesMade: 0,
      verdictsAgreed: 0,
      verdictsDecided: 0,
    };
    const createdAt: Date = new Date("2026-11-18T10:00:00.000Z");

    expect(
      AiOutcomesBuilder.countPullRequestFixKinds(
        [
          {
            createdAt,
            productionStatus: FixProductionStatus.Verified,
            productionCheck: FixProductionCheck.TelemetryLeak,
          },
          {
            createdAt,
            productionStatus: FixProductionStatus.Regressed,
            productionCheck: FixProductionCheck.TelemetryLeak,
          },
          {
            createdAt,
            productionStatus: FixProductionStatus.AwaitingDeploy,
            productionCheck: FixProductionCheck.StoreConfiguration,
          },
          // Watched before the column existed: an exception's fix.
          {
            createdAt,
            productionStatus: FixProductionStatus.Verified,
            productionCheck: null,
          },
          // Outside the window: not counted.
          {
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            productionStatus: FixProductionStatus.Verified,
            productionCheck: FixProductionCheck.TelemetryLeak,
          },
        ],
        (when: Date): AiOutcomesWeek | null => {
          return when.getTime() >= new Date("2026-11-16").getTime()
            ? week
            : null;
        },
      ),
    ).toEqual([
      {
        check: FixProductionCheck.TelemetryLeak,
        verified: 1,
        regressed: 1,
        watching: 0,
        awaitingDeploy: 0,
        unverifiable: 0,
      },
      {
        check: FixProductionCheck.Exception,
        verified: 1,
        regressed: 0,
        watching: 0,
        awaitingDeploy: 0,
        unverifiable: 0,
      },
      {
        check: FixProductionCheck.StoreConfiguration,
        verified: 0,
        regressed: 0,
        watching: 0,
        awaitingDeploy: 1,
        unverifiable: 0,
      },
    ]);
  });
});
