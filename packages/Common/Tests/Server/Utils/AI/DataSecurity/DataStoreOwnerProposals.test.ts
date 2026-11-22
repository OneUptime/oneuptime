import Queue from "../../../../../Server/Infrastructure/Queue";
import AIService, {
  ProjectAiDailyLimitStatus,
} from "../../../../../Server/Services/AIService";
import AutoRemediationRuleService from "../../../../../Server/Services/AutoRemediationRuleService";
import { Service as CodeRepositoryServiceClass } from "../../../../../Server/Services/CodeRepositoryService";
import ChangeEventService from "../../../../../Server/Services/ChangeEventService";
import DataSecurityAiDecisionService from "../../../../../Server/Services/DataSecurityAiDecisionService";
import DataSecurityAiProposalService from "../../../../../Server/Services/DataSecurityAiProposalService";
import DataSecurityCustomDataTypeService from "../../../../../Server/Services/DataSecurityCustomDataTypeService";
import DataSecurityIssueFeedService from "../../../../../Server/Services/DataSecurityIssueFeedService";
import DataSecurityIssueService from "../../../../../Server/Services/DataSecurityIssueService";
import DataStoreAccessService from "../../../../../Server/Services/DataStoreAccessService";
import DataStoreFeedService from "../../../../../Server/Services/DataStoreFeedService";
import DataStoreOwnerTeamService from "../../../../../Server/Services/DataStoreOwnerTeamService";
import DataStoreOwnerUserService from "../../../../../Server/Services/DataStoreOwnerUserService";
import DataStoreService from "../../../../../Server/Services/DataStoreService";
import DatabaseService from "../../../../../Server/Services/DatabaseService";
import LlmLogService from "../../../../../Server/Services/LlmLogService";
import LlmProviderService from "../../../../../Server/Services/LlmProviderService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import ServiceOwnerTeamService from "../../../../../Server/Services/ServiceOwnerTeamService";
import ServiceOwnerUserService from "../../../../../Server/Services/ServiceOwnerUserService";
import ServiceService from "../../../../../Server/Services/ServiceService";
import TeamMemberService from "../../../../../Server/Services/TeamMemberService";
import TeamPermissionService from "../../../../../Server/Services/TeamPermissionService";
import TeamService from "../../../../../Server/Services/TeamService";
import { Results } from "../../../../../Server/Services/AnalyticsDatabaseService";
import DataSecurityAiEngine, {
  DataSecurityAiEvaluation,
} from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiEngine";
import DeclaredCodeOwner, {
  DeclaredCodeOwnerCandidate,
} from "../../../../../Server/Utils/AI/Remediation/DeclaredCodeOwner";
import AIInvestigationEngine from "../../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import LLMService, {
  LLMCompletionRequest,
} from "../../../../../Server/Utils/LLM/LLMService";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import LlmProvider from "../../../../../Models/DatabaseModels/LlmProvider";
import Project from "../../../../../Models/DatabaseModels/Project";
import CodeRepositoryType from "../../../../../Types/CodeRepository/CodeRepositoryType";
import {
  DataSecurityAiAutonomy,
  DataSecurityAiChangeSafety,
  DataSecurityAiProposalKind,
  DataSecurityAiProposalStatus,
  DataSecurityAiWork,
} from "../../../../../Types/DataSecurity/DataSecurityAi";
import {
  DataSecurityAiDecisionReason,
  DataSecurityAiIssueSkipReason,
} from "../../../../../Types/DataSecurity/DataSecurityAiDecision";
import {
  DataStoreOwnerCandidate,
  DataStoreOwnerConfidence,
  DataStoreOwnerEvidence,
  DataStoreOwnerEvidenceSource,
  DataStoreOwnersPlan,
  readDataStoreOwnersPlan,
} from "../../../../../Types/DataSecurity/DataStoreOwnerProposal";
import RecordActorType from "../../../../../Types/Database/RecordActor";
import { DeclaredCodeOwnerReason } from "../../../../../Utils/AiRemediation/DeclaredCodeChange";
import { JSONObject } from "../../../../../Types/JSON";
import LlmType from "../../../../../Types/LLM/LlmType";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../../../TestingUtils/InMemoryRepository";
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
 * ONEUPTIME AI'S OWNERS FOR A STORE, THROUGH THE REAL PIPELINE (#10374).
 *
 * A "Nobody owns this sensitive store" issue opens, and the engine works on
 * it as the project's defaults say: Judge is Suggest, so OneUptime AI
 * proposes owners and the proposal waits for a person. Every table the
 * engine, the owner action, the evidence reader, the input builder, the one
 * Data Security call and the proposals read or write is held in memory;
 * only the model is a fake (LLMService.getCompletion), and the two reads
 * that leave OneUptime - a repository's files, and the cloud's change log
 * in ClickHouse - are stood in for. For each kind of evidence: what the
 * model is sent, and the proposal that comes of its answer.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10374000-0000-4000-8000-000000000001",
);
const ISSUE_ID: string = "10374000-0000-4000-8000-0000000000a1";
const STORE_ID: string = "10374000-0000-4000-8000-0000000000b1";
const PAYMENTS_TEAM_ID: string = "10374000-0000-4000-8000-0000000000c1";
const CHECKOUT_TEAM_ID: string = "10374000-0000-4000-8000-0000000000c2";
const ALICE_ID: string = "10374000-0000-4000-8000-0000000000d1";
const SERVICE_ID: string = "10374000-0000-4000-8000-0000000000e1";
const REPOSITORY_ID: string = "10374000-0000-4000-8000-0000000000f1";

// A person's name and email: never what OneUptime AI is told.
const ALICE_NAME: string = "Alice Plantedname";
const ALICE_EMAIL: string = "alice.planted@northwind.example";

const asService: <T extends BaseModel>(
  service: unknown,
) => DatabaseService<T> = <T extends BaseModel>(
  service: unknown,
): DatabaseService<T> => {
  return service as DatabaseService<T>;
};

let completion: SpyInstance<typeof LLMService.getCompletion>;
let proposals: InMemoryTable;
let decisions: InMemoryTable;
let modelAnswers: Array<string>;

function storeRow(overrides: StoredRow = {}): StoredRow {
  return {
    _id: STORE_ID,
    projectId: PROJECT_ID.toString(),
    name: "payments-ledger",
    kind: "AWS S3 Bucket",
    provider: "aws",
    region: "eu-north-1",
    environment: "Production",
    sensitivity: "Restricted",
    providerResourceId: "arn:aws:s3:::payments-ledger",
    dataTypeIds: ["iban"],
    cloudTags: {},
    isArchived: false,
    labels: [],
    ...overrides,
  };
}

function issueRow(): StoredRow {
  return {
    _id: ISSUE_ID,
    projectId: PROJECT_ID.toString(),
    checkId: "no-owner",
    checkGroup: "Hygiene",
    title: "Nobody owns this sensitive store",
    evidence: "It has no owner.",
    severity: "Medium",
    riskScore: 40,
    status: "Open",
    dataTypeIds: ["iban"],
    dataStoreId: STORE_ID,
    reopenCount: 0,
    dataStore: {
      _id: STORE_ID,
      name: "payments-ledger",
      kind: "AWS S3 Bucket",
      region: "eu-north-1",
      sensitivity: "Restricted",
      providerResourceId: "arn:aws:s3:::payments-ledger",
    },
  };
}

function useWorld(data: {
  store?: StoredRow;
  ownerUsers?: Array<StoredRow>;
  traced?: Array<StoredRow>;
  serviceOwnerTeams?: Array<StoredRow>;
}): void {
  useInMemoryTable(asService(DataStoreService), [data.store || storeRow()]);
  useInMemoryTable(asService(DataSecurityIssueService), [issueRow()]);
  useInMemoryTable(asService(DataSecurityCustomDataTypeService), []);
  useInMemoryTable(asService(AutoRemediationRuleService), []);
  useInMemoryTable(asService(DataStoreOwnerUserService), data.ownerUsers || []);
  useInMemoryTable(asService(DataStoreOwnerTeamService), []);
  useInMemoryTable(asService(DataStoreAccessService), data.traced || []);
  useInMemoryTable(asService(ServiceService), [
    {
      _id: SERVICE_ID,
      projectId: PROJECT_ID.toString(),
      name: "checkout",
      labels: [],
    },
  ]);
  useInMemoryTable(asService(ServiceOwnerUserService), []);
  useInMemoryTable(
    asService(ServiceOwnerTeamService),
    data.serviceOwnerTeams || [],
  );
  useInMemoryTable(asService(TeamService), [
    {
      _id: PAYMENTS_TEAM_ID,
      projectId: PROJECT_ID.toString(),
      name: "Payments",
    },
    {
      _id: CHECKOUT_TEAM_ID,
      projectId: PROJECT_ID.toString(),
      name: "Checkout",
    },
  ]);
  useInMemoryTable(asService(TeamMemberService), [
    {
      _id: "10374000-0000-4000-8000-0000000000d9",
      projectId: PROJECT_ID.toString(),
      teamId: PAYMENTS_TEAM_ID,
      userId: ALICE_ID,
      hasAcceptedInvitation: true,
      user: { _id: ALICE_ID, name: ALICE_NAME, email: ALICE_EMAIL },
    },
  ]);
  useInMemoryTable(asService(TeamPermissionService), [
    {
      _id: "10374000-0000-4000-8000-0000000000d8",
      projectId: PROJECT_ID.toString(),
      teamId: PAYMENTS_TEAM_ID,
      permission: Permission.SecurityMember,
      isBlockPermission: false,
      labels: [],
    },
  ]);
  proposals = useInMemoryTable(asService(DataSecurityAiProposalService), []);
  decisions = useInMemoryTable(asService(DataSecurityAiDecisionService), []);
  useInMemoryTable(asService(LlmLogService), []);
}

function answerWith(answer: JSONObject): void {
  modelAnswers.push(JSON.stringify(answer));
}

// Every message the model was sent, as text.
function sentToTheModel(): string {
  return completion.mock.calls
    .map((call: Array<unknown>): string => {
      return JSON.stringify((call[0] as LLMCompletionRequest).messages);
    })
    .join("\n");
}

// What the model was sent as data: the user message, read back.
function dataSentToTheModel(): JSONObject {
  const request: LLMCompletionRequest = completion.mock
    .calls[0]![0] as LLMCompletionRequest;

  return JSON.parse(String(request.messages[1]!.content)) as JSONObject;
}

async function evaluate(): Promise<DataSecurityAiEvaluation | null> {
  return await DataSecurityAiEngine.evaluateIssue({
    projectId: PROJECT_ID,
    dataSecurityIssueId: new ObjectID(ISSUE_ID),
  });
}

function onlyProposal(): StoredRow {
  expect(proposals.rows).toHaveLength(1);
  return proposals.rows[0]!;
}

function planOf(row: StoredRow): DataStoreOwnersPlan {
  const plan: DataStoreOwnersPlan | null = readDataStoreOwnersPlan(row["plan"]);

  expect(plan).not.toBeNull();
  return plan!;
}

beforeEach(() => {
  everyServerProductIsOn();
  modelAnswers = [];

  jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
    id: PROJECT_ID,
    enableAi: true,
    enableAutomaticDataSecurityAi: true,
    requireTwoApprovalsForRiskierFixes: false,
  } as unknown as Project);
  jest
    .spyOn(AIInvestigationEngine, "getProviderOrBalanceReason")
    .mockResolvedValue(null);
  jest
    .spyOn(AIService, "getReachedProjectDailyLimit")
    .mockImplementation(async (): Promise<ProjectAiDailyLimitStatus | null> => {
      return null;
    });
  jest.spyOn(LlmProviderService, "getProviderForChat").mockResolvedValue({
    id: ObjectID.generate(),
    name: "The project's provider",
    llmType: LlmType.Ollama,
    baseUrl: "http://ollama.internal:11434",
    modelName: "llama3.1",
    isGlobalLlm: false,
  } as unknown as LlmProvider);
  completion = jest
    .spyOn(LLMService, "getCompletion")
    .mockImplementation(async () => {
      return {
        content: modelAnswers.shift() || "{}",
        usage: { promptTokens: 300, completionTokens: 40, totalTokens: 340 },
      };
    });

  // What leaves OneUptime: no repository declares it, the change log is empty.
  jest.spyOn(DeclaredCodeOwner, "findCandidates").mockResolvedValue([]);
  jest.spyOn(ChangeEventService, "executeQuery").mockResolvedValue({
    json: async () => {
      return { data: [] };
    },
  } as unknown as Results);

  jest
    .spyOn(DataSecurityIssueFeedService, "createDataSecurityIssueFeedItem")
    .mockResolvedValue(undefined);
  jest
    .spyOn(DataStoreFeedService, "createDataStoreFeedItem")
    .mockResolvedValue(undefined);
  jest.spyOn(Queue, "addJob").mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("from a cloud tag", () => {
  test("a bucket tagged team=payments gets Payments, and the proposal waits for a person", async () => {
    useWorld({ store: storeRow({ cloudTags: { team: "payments" } }) });
    answerWith({
      owners: ["T1"],
      restsOn: ["E1"],
      confidence: "high",
      reason: "The team tag names {T1}.",
      disagreement: "",
    });

    const evaluation: DataSecurityAiEvaluation | null = await evaluate();

    expect(completion).toHaveBeenCalledTimes(1);

    const row: StoredRow = onlyProposal();
    const plan: DataStoreOwnersPlan = planOf(row);

    expect(row).toMatchObject({
      kind: DataSecurityAiProposalKind.SetStoreOwners,
      work: DataSecurityAiWork.Judge,
      safety: DataSecurityAiChangeSafety.ChangesWhoIsTold,
      status: DataSecurityAiProposalStatus.Proposed,
      autonomy: DataSecurityAiAutonomy.Suggest,
      title: "Make Payments the owner of payments-ledger",
    });
    expect(String(row["dataSecurityIssueId"]).toLowerCase()).toBe(ISSUE_ID);
    expect(String(row["dataStoreId"]).toLowerCase()).toBe(STORE_ID);
    expect(
      plan.owners.map((owner: DataStoreOwnerCandidate): string => {
        return owner.name;
      }),
    ).toEqual(["Payments"]);
    expect(plan.reason).toBe("The team tag names Payments.");
    expect(plan.confidence).toBe(DataStoreOwnerConfidence.High);
    expect(plan.ruleFacts).toEqual([
      { kind: "CloudTag", key: "team", value: "payments" },
      { kind: "NamePrefix", prefix: "payments-" },
    ]);
    // Every proposal names its evidence.
    expect(String(row["reasonMarkdown"])).toContain("team=payments");

    // Why AI did not act says what it did: proposed.
    expect(evaluation?.didAct).toBe(true);
    expect(decisions.rows).toHaveLength(1);
    expect(JSON.stringify(decisions.rows[0]!["entries"])).toContain(
      DataSecurityAiDecisionReason.Proposed,
    );

    // A few minutes on, the owner rules the proposals share.
    expect(Queue.addJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("data-security-owner-rules-"),
      "DataSecurity:ProposeOwnerRules",
      { projectId: PROJECT_ID.toString() },
      expect.objectContaining({ delayInMs: expect.any(Number) }),
    );
  });

  test("a tag that holds a person's email names them, and the model is told neither", async () => {
    useWorld({ store: storeRow({ cloudTags: { owner: ALICE_EMAIL } }) });
    answerWith({
      owners: ["P1"],
      restsOn: ["E1"],
      confidence: "medium",
      reason: "The owner tag names {P1}.",
      disagreement: "",
    });

    await evaluate();

    const sent: string = sentToTheModel();

    expect(sent.includes(ALICE_EMAIL)).toBe(false);
    expect(sent.includes(ALICE_NAME)).toBe(false);
    expect(dataSentToTheModel()["candidates"]).toEqual([
      { ref: "P1", kind: "person", canOpenStore: true },
    ]);

    const plan: DataStoreOwnersPlan = planOf(onlyProposal());

    // People read the name; only the model never knew it.
    expect(plan.reason).toBe(`The owner tag names ${ALICE_NAME}.`);
    expect(onlyProposal()["title"]).toBe(
      `Make ${ALICE_NAME} the owner of payments-ledger`,
    );
  });
});

describe("from the services that use it", () => {
  test("a store used only by the checkout service gets that service's owners, with the reason", async () => {
    useWorld({
      traced: [
        {
          _id: "10374000-0000-4000-8000-0000000000e9",
          projectId: PROJECT_ID.toString(),
          dataStoreId: STORE_ID,
          principal: SERVICE_ID,
          principalName: "checkout",
          principalType: "Service",
          isSeenInTraces: true,
          lastUsedAt: new Date(),
        },
      ],
      serviceOwnerTeams: [
        {
          _id: "10374000-0000-4000-8000-0000000000e8",
          projectId: PROJECT_ID.toString(),
          serviceId: SERVICE_ID,
          teamId: CHECKOUT_TEAM_ID,
        },
      ],
    });
    answerWith({
      owners: ["T1"],
      restsOn: ["E1"],
      confidence: "medium",
      reason: "Only the checkout service uses the store, and {T1} owns it.",
      disagreement: "",
    });

    await evaluate();

    const data: JSONObject = dataSentToTheModel();

    expect(data["servicesUsingIt"]).toBe(1);
    expect(data["evidence"]).toEqual([
      {
        id: "E1",
        source: "owners of a service that uses it",
        service: "checkout",
        names: ["T1"],
      },
    ]);

    const plan: DataStoreOwnersPlan = planOf(onlyProposal());

    expect(plan.owners[0]!.name).toBe("Checkout");
    // Checkout holds no permission that reads data stores.
    expect(plan.owners[0]!.canOpenStore).toBe(false);
    expect(plan.reason).toBe(
      "Only the checkout service uses the store, and Checkout owns it.",
    );
    expect(String(onlyProposal()["changeMarkdown"])).toContain(
      "cannot open this store",
    );
  });
});

describe("from the code owners of the file that declares it", () => {
  test("the declaring file's code owners name the team by its handle", async () => {
    useWorld({ store: storeRow({ cloudTags: { "managed-by": "terraform" } }) });

    const candidate: DeclaredCodeOwnerCandidate = {
      repository: {
        id: REPOSITORY_ID,
        name: "infra",
        organizationName: "northwind",
        repositoryName: "infra",
        mainBranchName: "main",
        gitHubAppInstallationId: "1",
        repositoryHostedAt: CodeRepositoryType.GitHub,
      },
      reason: DeclaredCodeOwnerReason.HasNamedFile,
      matchedPaths: ["s3/payments-ledger.tf"],
      score: 60,
    };

    jest
      .spyOn(DeclaredCodeOwner, "findCandidates")
      .mockResolvedValue([candidate]);

    const fileText: SpyInstance<
      typeof CodeRepositoryServiceClass.getRepositoryFileText
    > = jest
      .spyOn(CodeRepositoryServiceClass, "getRepositoryFileText")
      .mockImplementation(async (_repository: unknown, path: string) => {
        return path === ".github/CODEOWNERS"
          ? "* @northwind/platform\n/s3/ @northwind/payments\n"
          : null;
      });

    answerWith({
      owners: ["T1"],
      restsOn: ["E1"],
      confidence: "high",
      reason: "The declaring file's code owners name {T1}.",
      disagreement: "",
    });

    await evaluate();

    expect(fileText).toHaveBeenCalledWith(
      candidate.repository,
      ".github/CODEOWNERS",
    );

    const evidence: DataStoreOwnerEvidence =
      planOf(onlyProposal()).evidence[0]!;

    expect(evidence).toMatchObject({
      source: DataStoreOwnerEvidenceSource.CodeOwners,
      repositoryName: "northwind/infra",
      filePath: "s3/payments-ledger.tf",
      codeOwnersPath: ".github/CODEOWNERS",
      codeOwner: "@northwind/payments",
    });
    expect(planOf(onlyProposal()).owners[0]!.name).toBe("Payments");
  });
});

describe("from who changed it", () => {
  test("the member the cloud's change log names, by email the model never sees", async () => {
    useWorld({});
    jest.spyOn(ChangeEventService, "executeQuery").mockResolvedValue({
      json: async () => {
        return {
          data: [
            {
              actor: `arn:aws:sts::123456789012:assumed-role/AWSReservedSSO_Admin/${ALICE_EMAIL}`,
              operation: "s3:PutBucketPolicy",
              changes: "3",
              lastChangedAtInMs: "1793530800000",
            },
          ],
        };
      },
    } as unknown as Results);
    answerWith({
      owners: ["P1"],
      restsOn: ["E1"],
      confidence: "low",
      reason: "{P1} changed the bucket's policy, the only lead there is.",
      disagreement: "",
    });

    await evaluate();

    expect(sentToTheModel().includes(ALICE_EMAIL)).toBe(false);
    expect(sentToTheModel().includes("123456789012")).toBe(false);

    const plan: DataStoreOwnersPlan = planOf(onlyProposal());

    expect(plan.evidence[0]).toMatchObject({
      source: DataStoreOwnerEvidenceSource.ChangedBy,
      operation: "s3:PutBucketPolicy",
      changeCount: 3,
    });
    expect(plan.owners[0]!.name).toBe(ALICE_NAME);
    expect(plan.confidence).toBe(DataStoreOwnerConfidence.Low);
  });
});

describe("from who added it to OneUptime", () => {
  test("the member who added the store", async () => {
    useWorld({
      store: storeRow({
        createdByActorType: RecordActorType.User,
        createdByUserId: ALICE_ID,
      }),
    });
    answerWith({
      owners: ["P1"],
      restsOn: ["E1"],
      confidence: "low",
      reason: "{P1} added the store to OneUptime.",
      disagreement: "",
    });

    await evaluate();

    expect(planOf(onlyProposal()).evidence[0]!.source).toBe(
      DataStoreOwnerEvidenceSource.AddedBy,
    );
  });

  test("an API key, a workflow or OneUptime itself is no evidence", async () => {
    useWorld({
      store: storeRow({
        createdByActorType: RecordActorType.System,
        createdByUserId: ALICE_ID,
      }),
    });

    await evaluate();

    expect(completion).not.toHaveBeenCalled();
    expect(proposals.rows).toHaveLength(0);
  });
});

describe("held to its evidence", () => {
  test("an owner the model made up is dropped; with nothing left, nothing is proposed", async () => {
    useWorld({ store: storeRow({ cloudTags: { team: "payments" } }) });
    answerWith({
      owners: ["T9", "P4"],
      restsOn: ["E7"],
      confidence: "high",
      reason: "Make {T9} the owner.",
      disagreement: "",
    });

    await evaluate();

    expect(proposals.rows).toHaveLength(0);
    expect(JSON.stringify(decisions.rows[0]!["entries"])).toContain(
      "no-owner-named",
    );
  });

  test("an answer that is not the JSON asked for is no answer", async () => {
    useWorld({ store: storeRow({ cloudTags: { team: "payments" } }) });
    modelAnswers.push("Payments owns it, I think.");

    await evaluate();

    expect(proposals.rows).toHaveLength(0);
    expect(JSON.stringify(decisions.rows[0]!["entries"])).toContain(
      "answer-not-read",
    );
  });

  test("where the evidence disagrees, the proposal says so and is Low sure", async () => {
    useWorld({
      store: storeRow({ cloudTags: { team: "payments" } }),
      traced: [
        {
          _id: "10374000-0000-4000-8000-0000000000e9",
          projectId: PROJECT_ID.toString(),
          dataStoreId: STORE_ID,
          principal: SERVICE_ID,
          principalName: "checkout",
          principalType: "Service",
          isSeenInTraces: true,
          lastUsedAt: new Date(),
        },
      ],
      serviceOwnerTeams: [
        {
          _id: "10374000-0000-4000-8000-0000000000e8",
          projectId: PROJECT_ID.toString(),
          serviceId: SERVICE_ID,
          teamId: CHECKOUT_TEAM_ID,
        },
      ],
    });
    answerWith({
      owners: ["T1"],
      restsOn: ["E1"],
      confidence: "high",
      reason: "The team tag names {T1}.",
      disagreement:
        "Tags say {T1}, but only the checkout service, {T2}'s, uses it.",
    });

    await evaluate();

    const plan: DataStoreOwnersPlan = planOf(onlyProposal());

    expect(plan.confidence).toBe(DataStoreOwnerConfidence.Low);
    expect(plan.disagreement).toBe(
      "Tags say Payments, but only the checkout service, Checkout's, uses it.",
    );
    expect(String(onlyProposal()["reasonMarkdown"])).toContain(
      "The evidence disagrees",
    );
  });
});

describe("when there is nothing to ask", () => {
  test("a store nothing points to: no model is asked", async () => {
    useWorld({});

    const evaluation: DataSecurityAiEvaluation | null = await evaluate();

    expect(completion).not.toHaveBeenCalled();
    expect(proposals.rows).toHaveLength(0);
    expect(evaluation?.skipReason).toBe(
      DataSecurityAiIssueSkipReason.NothingToDo,
    );
    expect(JSON.stringify(decisions.rows[0]!["entries"])).toContain(
      "no-evidence-of-owner",
    );
  });

  test("a store that has an owner already: no model is asked", async () => {
    useWorld({
      store: storeRow({ cloudTags: { team: "payments" } }),
      ownerUsers: [
        {
          _id: "10374000-0000-4000-8000-0000000000d7",
          projectId: PROJECT_ID.toString(),
          dataStoreId: STORE_ID,
          userId: ALICE_ID,
        },
      ],
    });

    await evaluate();

    expect(completion).not.toHaveBeenCalled();
    expect(proposals.rows).toHaveLength(0);
  });

  test("no LLM provider: nothing is asked, and Why AI did not act says so", async () => {
    useWorld({ store: storeRow({ cloudTags: { team: "payments" } }) });
    jest
      .spyOn(AIInvestigationEngine, "getProviderOrBalanceReason")
      .mockResolvedValue("provider_missing");

    await evaluate();

    expect(completion).not.toHaveBeenCalled();
    expect(JSON.stringify(decisions.rows[0]!["entries"])).toContain(
      "no-llm-provider",
    );
  });
});

describe("with AI off", () => {
  test("Enable AI off: nothing runs, nothing is written", async () => {
    useWorld({ store: storeRow({ cloudTags: { team: "payments" } }) });
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: PROJECT_ID,
      enableAi: false,
      enableAutomaticDataSecurityAi: true,
    } as unknown as Project);

    expect(await evaluate()).toBeNull();
    expect(completion).not.toHaveBeenCalled();
    expect(proposals.rows).toHaveLength(0);
    expect(decisions.rows).toHaveLength(0);
  });

  test("Work on new issues off: nothing runs, nothing is written", async () => {
    useWorld({ store: storeRow({ cloudTags: { team: "payments" } }) });
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: PROJECT_ID,
      enableAi: true,
      enableAutomaticDataSecurityAi: false,
    } as unknown as Project);

    expect(await evaluate()).toBeNull();
    expect(completion).not.toHaveBeenCalled();
    expect(proposals.rows).toHaveLength(0);
  });

  test("an AI rule that turns Judge off: no owner is proposed", async () => {
    useWorld({ store: storeRow({ cloudTags: { team: "payments" } }) });
    useInMemoryTable(asService(AutoRemediationRuleService), [
      {
        _id: "10374000-0000-4000-8000-0000000000aa",
        projectId: PROJECT_ID.toString(),
        name: "No judging",
        isEnabled: true,
        triggerEntityType: "DataSecurityIssue",
        dataSecurityAnalyze: DataSecurityAiAutonomy.Off,
        dataSecurityContain: DataSecurityAiAutonomy.Suggest,
        dataSecurityFix: DataSecurityAiAutonomy.Off,
        dataSecurityJudge: DataSecurityAiAutonomy.Off,
      },
    ]);

    await evaluate();

    expect(completion).not.toHaveBeenCalled();
    expect(proposals.rows).toHaveLength(0);
  });

  test("an AI rule that sets Judge to Without asking still waits for a person", async () => {
    useWorld({ store: storeRow({ cloudTags: { team: "payments" } }) });
    useInMemoryTable(asService(AutoRemediationRuleService), [
      {
        _id: "10374000-0000-4000-8000-0000000000ab",
        projectId: PROJECT_ID.toString(),
        name: "Judge on its own",
        isEnabled: true,
        triggerEntityType: "DataSecurityIssue",
        dataSecurityAnalyze: DataSecurityAiAutonomy.Off,
        dataSecurityContain: DataSecurityAiAutonomy.Off,
        dataSecurityFix: DataSecurityAiAutonomy.Off,
        dataSecurityJudge: DataSecurityAiAutonomy.WithoutAsking,
      },
    ]);
    answerWith({
      owners: ["T1"],
      restsOn: ["E1"],
      confidence: "high",
      reason: "The team tag names {T1}.",
      disagreement: "",
    });

    await evaluate();

    expect(onlyProposal()).toMatchObject({
      status: DataSecurityAiProposalStatus.Proposed,
      autonomy: DataSecurityAiAutonomy.WithoutAsking,
      askReason: "AlwaysAsks",
    });
  });
});
