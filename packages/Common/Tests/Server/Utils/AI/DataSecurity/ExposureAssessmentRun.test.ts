import AutoRemediationRule from "../../../../../Models/DatabaseModels/AutoRemediationRule";
import Queue from "../../../../../Server/Infrastructure/Queue";
import AIService from "../../../../../Server/Services/AIService";
import ChangeEventService from "../../../../../Server/Services/ChangeEventService";
import MailService from "../../../../../Server/Services/MailService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import SecurityCaseFeedService from "../../../../../Server/Services/SecurityCaseFeedService";
import DataSecurityAiCall from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiCall";
import DataSecurityAiEngine from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiEngine";
import { DataSecurityAiPrompt } from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiInput";
import { ExposureDraftSkip } from "../../../../../Server/Utils/AI/DataSecurity/ExposureAssessmentDrafter";
import ExposureAssessmentRun, {
  ExposureRunAiSkip,
  ExposureRunOutcome,
  ExposureRunSkip,
} from "../../../../../Server/Utils/AI/DataSecurity/ExposureAssessmentRun";
import AIInvestigationEngine from "../../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import ProjectLanguage from "../../../../../Server/Utils/Notification/ProjectLanguage";
import FeedPersonName from "../../../../../Server/Utils/Feed/FeedPersonName";
import { DataSecurityAiAutonomy } from "../../../../../Types/DataSecurity/DataSecurityAi";
import { DataSecurityAiFeature } from "../../../../../Types/DataSecurity/DataSecurityAiFeatures";
import {
  ExposureAssessmentStarter,
  ExposureDraftPart,
  readStoredExposureAssessment,
  StoredExposureAssessment,
} from "../../../../../Types/DataSecurity/ExposureAssessment";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  caseRow,
  CASE_ID,
  ExposureTables,
  issueRow,
  ISSUE_ID,
  NOW,
  PLANTED,
  PROJECT_ID,
  startedAssessment,
  STORE_ID,
  storeRow,
  useExposureTables,
} from "./ExposureAssessmentTables";
import { everyServerProductIsOn } from "../../../TestingUtils/ServerProductsOn";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * WHEN AN EXPOSURE IS ASSESSED ON ITS OWN (#10377): the job Data Security
 * queues as it opens a case for a Critical issue (ExposureAssessmentRun).
 * A Critical exposure of a store with Restricted or Confidential data is
 * assessed, once per case, AI on or off; OneUptime AI writes it up only as
 * the project's switches and Data Security AI rules allow its Analyze work
 * (#10364). The tables are in memory (ExposureAssessmentTables); the model
 * and the rules are stood in for.
 */

let tables: ExposureTables;
let asked: SpyInstance<typeof DataSecurityAiCall.ask>;
let project: SpyInstance<typeof ProjectService.findOneById>;
let rules: SpyInstance<typeof DataSecurityAiEngine.readRules>;
let timeline: SpyInstance<
  typeof SecurityCaseFeedService.createSecurityCaseFeedItem
>;

// What the case keeps now.
function kept(): StoredExposureAssessment | null {
  return readStoredExposureAssessment(
    tables.cases.get(CASE_ID)!["exposureAssessment"],
  );
}

// A write-up of the parts asked, citing every fact the prompt gave.
function answerTo(prompt: DataSecurityAiPrompt): string {
  const ids: Array<string> = (prompt.data["facts"] as Array<JSONObject>).map(
    (fact: JSONObject): string => {
      return String(fact["id"]);
    },
  );
  const answer: JSONObject = {};

  for (const write of prompt.data["write"] as Array<JSONObject>) {
    answer[String(write["part"])] = {
      markdown:
        "Anyone on the internet could read the bucket, and its reads were not logged, so treat the data as read. [Measures taken].",
      facts: ids,
    };
  }

  return JSON.stringify(answer);
}

async function run(): Promise<ExposureRunOutcome> {
  return await ExposureAssessmentRun.run({
    projectId: PROJECT_ID,
    securityCaseId: new ObjectID(CASE_ID),
    dataSecurityIssueId: new ObjectID(ISSUE_ID),
    now: NOW,
  });
}

function projectWith(switches: JSONObject): void {
  project.mockResolvedValue({
    id: PROJECT_ID,
    enableAi: true,
    enableAutomaticDataSecurityAi: true,
    ...switches,
  } as never);
}

// The project's Data Security AI rules: one, which the issue matches as given.
function rulesMatching(matching: Array<JSONObject>): void {
  rules.mockResolvedValue([new AutoRemediationRule()]);
  jest
    .spyOn(DataSecurityAiEngine, "matchRules")
    .mockReturnValue(matching as never);
}

beforeEach(() => {
  everyServerProductIsOn();
  tables = useExposureTables({
    issues: [issueRow({ status: "Open", resolvedAt: null })],
  });

  asked = jest
    .spyOn(DataSecurityAiCall, "ask")
    .mockImplementation((async (data: { prompt: DataSecurityAiPrompt }) => {
      return { content: answerTo(data.prompt) };
    }) as never);
  project = jest.spyOn(ProjectService, "findOneById");
  projectWith({});
  // No Data Security AI rule set up: the defaults analyze a Critical issue.
  rules = jest.spyOn(DataSecurityAiEngine, "readRules").mockResolvedValue([]);
  jest
    .spyOn(AIInvestigationEngine, "getProviderOrBalanceReason")
    .mockResolvedValue(null);
  jest
    .spyOn(AIService, "getReachedProjectDailyLimit")
    .mockResolvedValue(null as never);
  jest.spyOn(ProjectLanguage, "getLanguage").mockResolvedValue("en" as never);
  jest.spyOn(FeedPersonName, "getText").mockResolvedValue("Alice Example");
  timeline = jest
    .spyOn(SecurityCaseFeedService, "createSecurityCaseFeedItem")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ChangeEventService, "executeQuery")
    .mockRejectedValue(new Error("No change log in this test."));
  jest.spyOn(MailService, "sendMail").mockResolvedValue(undefined as never);
  jest.spyOn(Queue, "addJob").mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("which exposures are assessed on their own", () => {
  test("the EU emails bucket: assessed by Data Security, and written up by OneUptime AI on its own", async () => {
    const outcome: ExposureRunOutcome = await run();

    expect(outcome.started).toBe(true);
    expect(outcome.skipped).toBeNull();
    expect(outcome.aiSkipped).toBeNull();
    expect(outcome.drafted).toEqual({
      drafted: true,
      parts: [
        ExposureDraftPart.Explanation,
        ExposureDraftPart.RegulatorNotice,
        ExposureDraftPart.PeopleNotice,
        ExposureDraftPart.InternalSummary,
      ],
    });
    expect(kept()).toMatchObject({
      dataStoreId: STORE_ID,
      startedBy: ExposureAssessmentStarter.DataSecurity,
    });
    expect(kept()!.sections[ExposureDraftPart.RegulatorNotice]).toBeDefined();

    const call: JSONObject = asked.mock.calls[0]![0] as unknown as JSONObject;

    expect(
      (call["prompt"] as unknown as DataSecurityAiPrompt).feature,
    ).toBe(DataSecurityAiFeature.DraftExposureAssessment);
    expect(call["protectRequestParameters"]).toBe(true);

    // What the model was sent carries no value the tables keep.
    const sentToTheModel: string = JSON.stringify(
      (call["prompt"] as unknown as DataSecurityAiPrompt).messages,
    );

    for (const planted of Object.values(PLANTED)) {
      expect(sentToTheModel).not.toContain(planted);
    }

    // The timeline: assessed, then written up - when, never what.
    expect(timeline).toHaveBeenCalledTimes(2);
  });

  test("the website images bucket - Public data, open to anyone - gets no assessment", async () => {
    tables = useExposureTables({
      stores: [
        storeRow({
          name: "website-images",
          sensitivity: "Public",
          dataTypeIds: [],
          subjectCountries: [],
        }),
      ],
      issues: [issueRow({ status: "Open", resolvedAt: null })],
    });

    const outcome: ExposureRunOutcome = await run();

    expect(outcome).toEqual({
      started: false,
      skipped: ExposureRunSkip.NotAssessedOnItsOwn,
      aiSkipped: null,
      drafted: null,
    });
    expect(kept()).toBeNull();
    expect(tables.cases.updates).toHaveLength(0);
    expect(timeline).not.toHaveBeenCalled();
    expect(asked).not.toHaveBeenCalled();
  });

  test.each([
    ["an Internal store", { sensitivity: "Internal" }, {}],
    ["a High issue", {}, { severity: "High" }],
    [
      "a check that is not an exposure",
      {},
      { checkId: "not-encrypted-at-rest", title: "Not encrypted at rest" },
    ],
  ])(
    "%s gets none",
    async (_what: string, store: JSONObject, issue: JSONObject) => {
      tables = useExposureTables({
        stores: [storeRow(store)],
        issues: [issueRow({ status: "Open", resolvedAt: null, ...issue })],
      });

      expect((await run()).skipped).toBe(ExposureRunSkip.NotAssessedOnItsOwn);
      expect(kept()).toBeNull();
    },
  );

  test("a store a person said is Restricted is assessed by what they said", async () => {
    tables = useExposureTables({
      stores: [storeRow({ sensitivity: "Public", sensitivityOverride: "Restricted" })],
      issues: [issueRow({ status: "Open", resolvedAt: null })],
    });

    expect((await run()).started).toBe(true);
  });

  test("an issue resolved before the job ran is still assessed: its window is what happened", async () => {
    tables = useExposureTables();

    const outcome: ExposureRunOutcome = await run();

    expect(outcome.started).toBe(true);
  });

  test("a case assessed already keeps its assessment, and nothing is asked", async () => {
    tables = useExposureTables({
      cases: [caseRow({ exposureAssessment: startedAssessment() })],
      issues: [issueRow({ status: "Open", resolvedAt: null })],
    });

    const outcome: ExposureRunOutcome = await run();

    expect(outcome.skipped).toBe(ExposureRunSkip.AlreadyAssessed);
    expect(tables.cases.updates).toHaveLength(0);
    expect(asked).not.toHaveBeenCalled();
  });

  test.each([
    ["an issue that is gone", { issues: [] }],
    ["an archived store", { stores: [storeRow({ isArchived: true })] }],
  ])("%s is not assessed", async (_what: string, data: JSONObject) => {
    tables = useExposureTables(data as never);

    expect((await run()).skipped).toBe(ExposureRunSkip.IssueGone);
    expect(kept()).toBeNull();
  });

  test("a failure is caught and logged: it never throws", async () => {
    jest
      .spyOn(ExposureAssessmentRun, "decideAi")
      .mockRejectedValue(new Error("Postgres went away"));

    const outcome: ExposureRunOutcome = await run();

    expect(outcome.drafted).toBeNull();
  });
});

describe("whether OneUptime AI writes it up on its own", () => {
  test.each([
    ["Enable AI off", { enableAi: false }],
    ["Work on new Data Security issues off", { enableAutomaticDataSecurityAi: false }],
  ])(
    "with %s, it is assessed and not written up",
    async (_what: string, switches: JSONObject) => {
      projectWith(switches);

      const outcome: ExposureRunOutcome = await run();

      expect(outcome.started).toBe(true);
      expect(outcome.aiSkipped).toBe(ExposureRunAiSkip.AiOff);
      expect(kept()!.sections).toEqual({});
      expect(asked).not.toHaveBeenCalled();
    },
  );

  test("rules that cannot be read write nothing up", async () => {
    rules.mockResolvedValue(null);

    const outcome: ExposureRunOutcome = await run();

    expect(outcome.started).toBe(true);
    expect(outcome.aiSkipped).toBe(ExposureRunAiSkip.RulesUnreadable);
    expect(asked).not.toHaveBeenCalled();
  });

  test("rules set up, none matching: nothing written up", async () => {
    rulesMatching([]);

    expect((await run()).aiSkipped).toBe(ExposureRunAiSkip.NoMatchingRule);
    expect(asked).not.toHaveBeenCalled();
  });

  test("a rule that turns Analyze off: nothing written up", async () => {
    rulesMatching([
      {
        _id: ObjectID.generate().toString(),
        name: "Leave the payments stores to us",
        dataSecurityAnalyze: DataSecurityAiAutonomy.Off,
      },
    ]);

    expect((await run()).aiSkipped).toBe(ExposureRunAiSkip.AnalyzeOff);
    expect(asked).not.toHaveBeenCalled();
  });

  test("a rule that analyzes, on the provider it picks: written up on it", async () => {
    const provider: string = ObjectID.generate().toString();

    rulesMatching([
      {
        _id: ObjectID.generate().toString(),
        name: "Analyze the EU stores",
        dataSecurityAnalyze: DataSecurityAiAutonomy.WithoutAsking,
        llmProviderId: provider,
      },
    ]);

    const outcome: ExposureRunOutcome = await run();

    expect(outcome.drafted!.drafted).toBe(true);
    expect(
      (asked.mock.calls[0]![0] as unknown as JSONObject)[
        "rulePickedProviderId"
      ],
    ).toBe(provider);
  });

  test("no provider: assessed, nothing written up, and a person can still ask", async () => {
    jest
      .spyOn(AIInvestigationEngine, "getProviderOrBalanceReason")
      .mockResolvedValue("provider_missing");

    const outcome: ExposureRunOutcome = await run();

    expect(outcome.started).toBe(true);
    expect(outcome.drafted).toEqual({
      drafted: false,
      reason: ExposureDraftSkip.NoLlmProvider,
    });
    expect(kept()!.dataStoreId).toBe(STORE_ID);
  });
});
