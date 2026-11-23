jest.mock("../../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      getLogLevel: jest.fn().mockReturnValue("INFO"),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import DatabaseConfig from "../../../../../Server/DatabaseConfig";
import AIService from "../../../../../Server/Services/AIService";
import AutoRemediationRuleService from "../../../../../Server/Services/AutoRemediationRuleService";
import DataSecurityAiDecisionService from "../../../../../Server/Services/DataSecurityAiDecisionService";
import DataSecurityAiProposalService from "../../../../../Server/Services/DataSecurityAiProposalService";
import DataSecurityCustomDataTypeService from "../../../../../Server/Services/DataSecurityCustomDataTypeService";
import DataSecurityFlowService from "../../../../../Server/Services/DataSecurityFlowService";
import DataSecurityIssueFeedService from "../../../../../Server/Services/DataSecurityIssueFeedService";
import DataSecurityIssueService from "../../../../../Server/Services/DataSecurityIssueService";
import DataStoreAccessService from "../../../../../Server/Services/DataStoreAccessService";
import DataStoreFindingService from "../../../../../Server/Services/DataStoreFindingService";
import DataStoreOwnerTeamService from "../../../../../Server/Services/DataStoreOwnerTeamService";
import DataStoreOwnerUserService from "../../../../../Server/Services/DataStoreOwnerUserService";
import DataStoreService from "../../../../../Server/Services/DataStoreService";
import DatabaseService from "../../../../../Server/Services/DatabaseService";
import LlmLogService from "../../../../../Server/Services/LlmLogService";
import LlmProviderService from "../../../../../Server/Services/LlmProviderService";
import MailService from "../../../../../Server/Services/MailService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import ServiceService from "../../../../../Server/Services/ServiceService";
import TeamMemberService from "../../../../../Server/Services/TeamMemberService";
import AiContextReader from "../../../../../Server/Utils/AI/AiContext/AiContextReader";
import DataSecurityAiActions from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiActions";
import DataSecurityAiEngine from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiEngine";
import DataSecurityOwnerNotice from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityOwnerNotice";
import AIInvestigationEngine from "../../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import DataSecurityIntegrations, {
  OpenedIssueForIntegrations,
} from "../../../../../Server/Utils/DataSecurity/DataSecurityIntegrations";
import * as DataSecurityJobs from "../../../../../Server/Utils/DataSecurity/DataSecurityJobs";
import DataSecurityResponse from "../../../../../Server/Utils/DataSecurity/DataSecurityResponse";
import LLMService, {
  LLMCompletionRequest,
} from "../../../../../Server/Utils/LLM/LLMService";
import ProjectLanguage from "../../../../../Server/Utils/Notification/ProjectLanguage";
import WorkspaceActionAuthorization from "../../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DataSecuritySetting from "../../../../../Models/DatabaseModels/DataSecuritySetting";
import { DataSecurityIssueFeedEventType } from "../../../../../Models/DatabaseModels/DataSecurityIssueFeed";
import LlmProvider from "../../../../../Models/DatabaseModels/LlmProvider";
import Project from "../../../../../Models/DatabaseModels/Project";
import User from "../../../../../Models/DatabaseModels/User";
import URL from "../../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  DataSecurityAiVerdict,
  readDataSecurityIssueAnalysis,
} from "../../../../../Types/DataSecurity/DataSecurityIssueAnalysis";
import DataSensitivity from "../../../../../Types/DataSecurity/DataSensitivity";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import { DataSecurityResponseAction } from "../../../../../Types/DataSecurity/DataSecurityResponseAction";
import Email from "../../../../../Types/Email";
import { JSONObject } from "../../../../../Types/JSON";
import LlmType from "../../../../../Types/LLM/LlmType";
import Name from "../../../../../Types/Name";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import SecuritySeverity from "../../../../../Types/SecuritySeverity";
import { visibleText } from "../../../../Helpers/HtmlText";
import { customDomainCaller } from "../../../API/CustomDomainCallers";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../../../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../../../TestingUtils/RequestPlan";
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
 * A NEW CRITICAL ISSUE, ANALYZED BEFORE ANYONE OPENS IT (#10369), through
 * the pipeline as the Workers run it:
 *
 *   1. Data Security opens the issue (DataSecurityIntegrations
 *      .onIssuesOpened): while OneUptime AI works on new issues, that
 *      queues its work on the issue and holds the store's owners' email;
 *   2. the queued job runs the engine (DataSecurityAiEngine.evaluateIssue),
 *      which has OneUptime AI analyze the issue - the issue's facts read by
 *      the input builder, asked through the one Data Security call, the
 *      answer held to its facts and kept on the issue;
 *   3. the held email goes (DataSecurityOwnerNotice.send), with the verdict
 *      and the shortest path under the issue - each line only for an owner
 *      who may read what it rests on.
 *
 * The tables are held in memory, and the queue's jobs are run by the test;
 * only the model (LLMService), its provider and the mail are stood in for.
 * What OneUptime AI proposes for the issue is #10364's, and its own tests':
 * here no action applies to it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10369000-0000-4000-8000-000000000001",
);
const ISSUE_ID: string = "10369000-0000-4000-8000-0000000000a1";
const STORE_ID: string = "10369000-0000-4000-8000-0000000000b1";
const ACCESS_ID: string = "10369000-0000-4000-8000-0000000000c1";
const FINDING_ID: string = "10369000-0000-4000-8000-0000000000d1";
const ROLE_ACCESS_ID: string = "10369000-0000-4000-8000-0000000000c2";
const DASHBOARD: string = "https://oneuptime.example.com/dashboard";

const BUCKET: string = "acme-card-exports";
const TITLE: string = "Anyone on the internet can read it";
// A card number the store's scan saw, masked: never sent to OneUptime AI.
const MASKED_SAMPLE: string = "4111 **** **** 1111";

const REASON: string = `Anyone on the internet can read the card numbers in ${BUCKET}.`;
const RISK: string =
  "About 12,000 card numbers: Everyone can read them through the bucket policy.";
const BREAKS: string =
  "Nothing OneUptime can see uses the bucket, so blocking public access breaks nothing.";
const PATH: string = "Block public access from this page now.";
const ANSWER: string = JSON.stringify({
  verdict: "Real",
  reason: { text: REASON, facts: ["S2", "S1"] },
  risk: { text: RISK, facts: ["S1", "R0", "R1"] },
  breaks: { text: BREAKS, facts: ["N1"] },
  path: { text: PATH, facts: ["A1"] },
  draft: null,
});

const OPENED_AT: Date = new Date("2026-11-20T10:00:00.000Z");
const LATER: Date = new Date("2026-11-20T10:01:00.000Z");

function storedIssue(): StoredRow {
  return {
    _id: ISSUE_ID,
    projectId: PROJECT_ID.toString(),
    title: TITLE,
    checkId: "public-read",
    checkGroup: "Exposure",
    evidence:
      "The bucket policy grants s3:GetObject to Principal * on acme-card-exports.",
    severity: "Critical",
    riskScore: 92,
    status: "Open",
    dataTypeIds: ["credit-card-number"],
    dataStoreId: STORE_ID,
    reopenCount: 0,
    dataStore: {
      _id: STORE_ID,
      name: BUCKET,
      kind: "AWS S3 Bucket",
      region: "eu-north-1",
      sensitivity: "Restricted",
      providerResourceId: "arn:aws:s3:::acme-card-exports",
    },
  };
}

function storedStore(): StoredRow {
  return {
    _id: STORE_ID,
    projectId: PROJECT_ID.toString(),
    name: BUCKET,
    kind: "AWS S3 Bucket",
    provider: "aws",
    region: "eu-north-1",
    sensitivity: "Restricted",
    providerResourceId: "arn:aws:s3:::acme-card-exports",
    dataTypeIds: ["credit-card-number"],
    exposure: "Public",
    estimatedRecords: 12_345,
    isPublicByDesign: false,
    isArchived: false,
  };
}

function publicGrant(): StoredRow {
  return {
    _id: ACCESS_ID,
    projectId: PROJECT_ID.toString(),
    dataStoreId: STORE_ID,
    principal: "*",
    principalName: "Everyone",
    principalType: "Public",
    accessLevel: "Read",
    grantedVia: "Bucket policy",
    isPublic: true,
    isExternal: true,
    isSeenInTraces: false,
  };
}

// What the store's scan found: the card numbers, with masked samples.
function cardFinding(): StoredRow {
  return {
    _id: FINDING_ID,
    projectId: PROJECT_ID.toString(),
    dataStoreId: STORE_ID,
    dataTypeId: "credit-card-number",
    dataTypeName: "Card number",
    sensitivity: "Restricted",
    location: "exports/orders.csv · card_number",
    locationKind: "Column",
    matchCount: 412,
    maskedSamples: [MASKED_SAMPLE],
  };
}

function openedIssue(): OpenedIssueForIntegrations {
  return {
    issueId: new ObjectID(ISSUE_ID),
    checkId: "public-read",
    title: TITLE,
    severity: SecuritySeverity.Critical,
    riskScore: 92,
    dataStoreId: new ObjectID(STORE_ID),
    dataStoreName: BUCKET,
    dataStoreKey: "cloud:aws:AWS S3 Bucket:arn:aws:s3:::acme-card-exports",
    dataStoreKind: DataStoreKind.AwsS3Bucket,
    sensitivity: DataSensitivity.Restricted,
  };
}

function userOf(name: string, email: string): User {
  const user: User = new User();
  user.id = ObjectID.generate();
  user.name = new Name(name);
  user.email = new Email(email);
  return user;
}

const asService: <T extends BaseModel>(
  service: unknown,
) => DatabaseService<T> = <T extends BaseModel>(
  service: unknown,
): DatabaseService<T> => {
  return service as DatabaseService<T>;
};

// The store's owners: one who reads Data Security, one who reads its stores only.
let alice: User;
let bob: User;
let permissionsOf: Map<string, Array<Permission>>;
let issues: InMemoryTable;
let access: InMemoryTable;
let decisions: InMemoryTable;
let enableAi: boolean;
let workOnNewIssues: boolean;
let setting: DataSecuritySetting;
let evaluations: Array<{ projectId: ObjectID; dataSecurityIssueId: ObjectID }>;
let heldNotices: Array<DataSecurityJobs.HeldOwnerNotice>;
let completion: SpyInstance<typeof LLMService.getCompletion>;
let feed: SpyInstance<
  typeof DataSecurityIssueFeedService.createDataSecurityIssueFeedItem
>;
let mail: SpyInstance<typeof MailService.sendMail>;

beforeEach(() => {
  alice = userOf("Alice Owner", "alice@acme.io");
  bob = userOf("Bob Owner", "bob@acme.io");
  permissionsOf = new Map([
    [alice.id!.toString(), [Permission.SecurityAdmin]],
    [bob.id!.toString(), [Permission.ReadDataStore]],
  ]);
  enableAi = true;
  workOnNewIssues = true;
  evaluations = [];
  heldNotices = [];
  setting = new DataSecuritySetting();
  setting.projectId = PROJECT_ID;
  // The issue's case, alert and incident are their own tests'.
  setting.openCasesForCriticalIssues = false;

  everyServerProductIsOn();

  issues = useInMemoryTable(asService(DataSecurityIssueService), [
    storedIssue(),
  ]);
  useInMemoryTable(asService(DataStoreService), [storedStore()]);
  access = useInMemoryTable(asService(DataStoreAccessService), [publicGrant()]);
  useInMemoryTable(asService(DataStoreFindingService), [cardFinding()]);
  useInMemoryTable(asService(DataSecurityCustomDataTypeService), []);
  useInMemoryTable(asService(DataSecurityFlowService), []);
  useInMemoryTable(asService(DataSecurityAiProposalService), []);
  decisions = useInMemoryTable(asService(DataSecurityAiDecisionService), []);
  useInMemoryTable(asService(AutoRemediationRuleService), []);
  useInMemoryTable(asService(ServiceService), []);
  useInMemoryTable(asService(DataStoreOwnerUserService), []);
  useInMemoryTable(asService(DataStoreOwnerTeamService), []);
  useInMemoryTable(asService(LlmLogService), []);

  // The project's two switches: Enable AI, and Work on new Data Security issues.
  jest.spyOn(ProjectService, "findOneById").mockImplementation((async () => {
    return {
      id: PROJECT_ID,
      enableAi,
      enableAutomaticDataSecurityAi: workOnNewIssues,
    } as unknown as Project;
  }) as never);

  // The queue: the test runs its jobs.
  jest
    .spyOn(DataSecurityJobs, "queueDataSecurityAiEvaluation")
    .mockImplementation(
      async (job: {
        projectId: ObjectID;
        dataSecurityIssueId: ObjectID;
      }): Promise<void> => {
        evaluations.push(job);
      },
    );
  jest
    .spyOn(DataSecurityJobs, "queueDataSecurityOwnerNotice")
    .mockImplementation(
      async (notice: DataSecurityJobs.HeldOwnerNotice): Promise<boolean> => {
        heldNotices.push({ ...notice, openedAt: OPENED_AT });
        return true;
      },
    );

  // What OneUptime AI proposes is #10364's: no action applies here.
  jest.spyOn(DataSecurityAiActions, "forWork").mockReturnValue([]);

  // Block Public Access can run from the issue's page.
  jest.spyOn(DataSecurityResponse, "getAvailability").mockResolvedValue({
    actions: [
      {
        action: DataSecurityResponseAction.BlockPublicAccess,
        isAvailable: true,
      },
    ],
  });
  jest.spyOn(ProjectLanguage, "getLanguage").mockResolvedValue("en");
  jest.spyOn(AiContextReader, "read").mockResolvedValue(null);

  // The project's own provider, with nothing in the way of using it.
  jest
    .spyOn(AIInvestigationEngine, "getProviderOrBalanceReason")
    .mockResolvedValue(null);
  jest.spyOn(AIService, "getReachedProjectDailyLimit").mockResolvedValue(null);
  jest.spyOn(LlmProviderService, "getProviderForChat").mockResolvedValue({
    id: ObjectID.generate(),
    name: "The project's provider",
    llmType: LlmType.OpenAI,
    modelName: "chat-large",
    isGlobalLlm: false,
  } as unknown as LlmProvider);
  completion = jest.spyOn(LLMService, "getCompletion").mockResolvedValue({
    content: ANSWER,
    usage: { promptTokens: 1400, completionTokens: 160, totalTokens: 1560 },
  });

  /*
   * The analysis is kept as one statement the tables in memory do not run:
   * written onto the issue's row here, as Postgres would.
   */
  jest
    .spyOn(DataSecurityIssueService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (args: {
      id: ObjectID;
      data: Record<string, unknown>;
    }) => {
      const row: StoredRow | undefined = issues.get(args.id);

      if (row) {
        for (const [column, value] of Object.entries(args.data)) {
          row[column] = value instanceof ObjectID ? value.toString() : value;
        }
      }
    }) as never);
  feed = jest
    .spyOn(DataSecurityIssueFeedService, "createDataSecurityIssueFeedItem")
    .mockResolvedValue(undefined);

  // The owners, both members of the project, and each one's permissions in it.
  jest
    .spyOn(DataSecurityIntegrations, "getOwnerUsers")
    .mockImplementation(async (): Promise<Array<User>> => {
      return [alice, bob];
    });
  jest
    .spyOn(TeamMemberService, "filterUsersToProjectMembers")
    .mockImplementation(async (data: { users: Array<User> }) => {
      return data.users;
    });
  jest
    .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
    .mockImplementation(
      async (data: {
        userId: ObjectID;
        projectId: ObjectID;
      }): Promise<DatabaseCommonInteractionProps> => {
        return {
          ...customDomainCaller({
            permissions: permissionsOf.get(data.userId.toString()) || [],
            projectId: data.projectId,
          }),
          userId: data.userId,
          ...ON_HIGHEST_PLAN,
        };
      },
    );
  jest
    .spyOn(DataStoreService, "getDataStoreLinkInDashboard")
    .mockImplementation(async (projectId: ObjectID, dataStoreId: ObjectID) => {
      return URL.fromString(
        `${DASHBOARD}/${projectId.toString()}/data-security/stores/${dataStoreId.toString()}`,
      );
    });
  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(URL.fromString(DASHBOARD));
  mail = jest
    .spyOn(MailService, "sendMail")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function opened(): Promise<void> {
  await DataSecurityIntegrations.onIssuesOpened({
    projectId: PROJECT_ID,
    setting,
    issues: [openedIssue()],
  });
}

// The queued job, as the worker runs it.
async function runEvaluations(): Promise<void> {
  for (const job of evaluations.splice(0)) {
    await DataSecurityAiEngine.evaluateIssue({ ...job, now: LATER });
  }

  // Each record of the work is stamped when it was written, as Postgres would.
  for (const row of decisions.rows) {
    row["createdAt"] = row["createdAt"] || LATER;
  }
}

// Each owner's email, by address, as its reader reads it.
function emails(): Map<string, string> {
  return new Map(
    mail.mock.calls.map((call: Array<unknown>): [string, string] => {
      const sent: { toEmail: Email; vars: { message: string } } =
        call[0] as never;

      // Read as words: no space a tag left before a colon or a full stop.
      return [
        sent.toEmail.toString(),
        visibleText(sent.vars.message).replace(/\s+([:.,])/g, "$1"),
      ];
    }),
  );
}

// The notice the store's owners' email was held as.
function heldNotice(): DataSecurityJobs.HeldOwnerNotice {
  return {
    projectId: PROJECT_ID,
    dataStoreId: new ObjectID(STORE_ID),
    issueIds: [new ObjectID(ISSUE_ID)],
    openedAt: OPENED_AT,
    attempt: 1,
  };
}

function analysisFeeds(): Array<JSONObject> {
  return feed.mock.calls
    .map((call: Array<unknown>): JSONObject => {
      return call[0] as JSONObject;
    })
    .filter((item: JSONObject): boolean => {
      return item["eventType"] === DataSecurityIssueFeedEventType.AiAnalysis;
    });
}

describe("a new Critical issue, while OneUptime AI works on new issues (#10369)", () => {
  test("is analyzed before anyone opens it, and its owners' email carries the verdict and the shortest path", async () => {
    await opened();

    // The email waits for the analysis; OneUptime AI's work is queued.
    expect(mail).not.toHaveBeenCalled();
    expect(evaluations).toHaveLength(1);
    expect(heldNotices).toHaveLength(1);

    await runEvaluations();

    // OneUptime AI was asked once, from what Data Security knows of the issue.
    expect(completion).toHaveBeenCalledTimes(1);
    const asked: string = JSON.stringify(
      (completion.mock.calls[0]![0] as LLMCompletionRequest).messages,
    );
    expect(asked).toContain(TITLE);
    expect(asked).toContain("Everyone");
    expect(asked).toContain(DataSecurityResponseAction.BlockPublicAccess);

    // The issue keeps it: the verdict, the lines held to their facts, when, and from what.
    const row: StoredRow = issues.get(ISSUE_ID)!;
    expect(row["aiVerdict"]).toBe(DataSecurityAiVerdict.Real);
    expect(row["aiAnalysisInputHash"]).toMatch(/^[0-9a-f]{64}$/);
    expect(row["aiAnalyzedAt"]).toBeInstanceOf(Date);
    expect(
      readDataSecurityIssueAnalysis(row["aiAnalysis"])?.lines.path,
    ).toEqual({ text: PATH, facts: ["A1"] });
    // Never the issue's status or severity: its check decides.
    expect(row["status"]).toBe("Open");
    expect(row["severity"]).toBe("Critical");

    // One timeline item, OneUptime AI's own: no person behind it.
    expect(analysisFeeds()).toHaveLength(1);
    expect(analysisFeeds()[0]).toMatchObject({
      feedInfoInMarkdown: "OneUptime AI analyzed this issue: **Real**.",
    });
    expect(analysisFeeds()[0]!["userId"]).toBeUndefined();

    // The held email goes, with the analysis in it.
    expect(await DataSecurityOwnerNotice.send(heldNotices[0]!, LATER)).toBe(
      "sent",
    );

    const sent: Map<string, string> = emails();
    const aliceReads: string = sent.get("alice@acme.io")!;

    expect(aliceReads).toContain(`Critical: ${TITLE}`);
    expect(aliceReads).toContain(`OneUptime AI: Real. ${REASON}`);
    expect(aliceReads).toContain(`Shortest path to fixed: ${PATH}`);
    expect(aliceReads).toContain(
      "OneUptime AI looks at new issues as your AI rules allow.",
    );

    // An owner who may not read the issue reads the email as it always was.
    const bobReads: string = sent.get("bob@acme.io")!;

    expect(bobReads).toContain(`Critical: ${TITLE}`);
    expect(bobReads).not.toContain("OneUptime AI: Real");
    expect(bobReads).not.toContain(REASON);
    expect(bobReads).not.toContain(PATH);
  });

  test("OneUptime AI is never sent a sensitive value, nor a record's id", async () => {
    await opened();
    await runEvaluations();

    const asked: string = JSON.stringify(
      (completion.mock.calls[0]![0] as LLMCompletionRequest).messages,
    );

    expect(asked).not.toContain(MASKED_SAMPLE);
    expect(asked).not.toContain("4111");
    expect(asked).not.toContain(ISSUE_ID);
    expect(asked).not.toContain(STORE_ID);
    expect(asked).not.toContain(ACCESS_ID);
    expect(asked).not.toContain(FINDING_ID);
  });

  test("the owners' email waits while OneUptime AI's work is still to come, and at most so long", async () => {
    await opened();

    // The job has not run yet: the email waits a minute more.
    heldNotices.length = 0;
    expect(
      await DataSecurityOwnerNotice.send(
        { ...heldNotice(), attempt: 1 },
        LATER,
      ),
    ).toBe("waiting");
    expect(
      heldNotices.map((notice: DataSecurityJobs.HeldOwnerNotice) => {
        return notice.attempt;
      }),
    ).toEqual([2]);
    expect(mail).not.toHaveBeenCalled();

    // Past the longest wait it goes with what there is: no analysis yet.
    const late: Date = new Date(
      OPENED_AT.getTime() + DataSecurityJobs.OWNER_NOTICE_MAX_WAIT_IN_MS,
    );

    expect(
      await DataSecurityOwnerNotice.send({ ...heldNotice(), attempt: 2 }, late),
    ).toBe("sent");
    expect(emails().get("alice@acme.io")).toContain(`Critical: ${TITLE}`);
    expect(emails().get("alice@acme.io")).not.toContain("OneUptime AI: ");
    expect(completion).not.toHaveBeenCalled();
  });

  test("worked on again with nothing it rests on changed, asks OneUptime AI nothing and writes nothing", async () => {
    await opened();
    await runEvaluations();

    const kept: unknown = issues.get(ISSUE_ID)!["aiAnalysis"];

    // The issue opens again: its work is queued again, and finds nothing new.
    await opened();
    await runEvaluations();

    expect(completion).toHaveBeenCalledTimes(1);
    expect(analysisFeeds()).toHaveLength(1);
    expect(issues.get(ISSUE_ID)!["aiAnalysis"]).toBe(kept);
  });

  test("worked on again once what it rests on changed, is analyzed again", async () => {
    await opened();
    await runEvaluations();

    // A role outside the project's accounts can now write to the bucket.
    access.rows.push({
      _id: ROLE_ACCESS_ID,
      projectId: PROJECT_ID.toString(),
      dataStoreId: STORE_ID,
      principal: "arn:aws:iam::210987654321:role/partner",
      principalName: "partner",
      principalType: "Role",
      accessLevel: "Write",
      grantedVia: "Bucket policy",
      isPublic: false,
      isExternal: true,
      isSeenInTraces: false,
    });

    await opened();
    await runEvaluations();

    expect(completion).toHaveBeenCalledTimes(2);
    expect(analysisFeeds()[1]).toMatchObject({
      feedInfoInMarkdown: "OneUptime AI analyzed this issue again: **Real**.",
    });
  });
});

describe("with OneUptime AI off, Data Security works exactly as it did", () => {
  test.each([
    ["Enable AI is off", { enableAi: false, workOnNewIssues: true }],
    [
      "Work on new Data Security issues is off",
      { enableAi: true, workOnNewIssues: false },
    ],
  ])(
    "%s: nothing is queued or asked, nothing is kept, and the owners' email goes now, with no word of OneUptime AI",
    async (
      _name: string,
      switches: { enableAi: boolean; workOnNewIssues: boolean },
    ) => {
      enableAi = switches.enableAi;
      workOnNewIssues = switches.workOnNewIssues;

      await opened();

      expect(evaluations).toEqual([]);
      expect(heldNotices).toEqual([]);
      expect(emails().get("alice@acme.io")).toContain(`Critical: ${TITLE}`);
      expect(emails().get("alice@acme.io")).not.toContain("OneUptime AI");

      // A job queued before the switch went off finds it off, and does nothing.
      expect(
        await DataSecurityAiEngine.evaluateIssue({
          projectId: PROJECT_ID,
          dataSecurityIssueId: new ObjectID(ISSUE_ID),
          now: LATER,
        }),
      ).toBeNull();
      expect(completion).not.toHaveBeenCalled();
      expect(issues.get(ISSUE_ID)!["aiAnalysis"]).toBeUndefined();
      expect(analysisFeeds()).toEqual([]);
      expect(decisions.rows).toEqual([]);
    },
  );

  test("a held email whose project turned AI off by the time it goes, goes as it always did", async () => {
    await opened();
    await runEvaluations();

    enableAi = false;

    expect(await DataSecurityOwnerNotice.send(heldNotices[0]!, LATER)).toBe(
      "sent",
    );
    expect(emails().get("alice@acme.io")).toContain(`Critical: ${TITLE}`);
    expect(emails().get("alice@acme.io")).not.toContain("OneUptime AI");
  });
});
