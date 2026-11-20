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

import CommonAPI from "../../../../../Server/API/CommonAPI";
import DataSecurityAPI from "../../../../../Server/API/DataSecurityAPI";
import Queue from "../../../../../Server/Infrastructure/Queue";
import UserMiddleware from "../../../../../Server/Middleware/UserAuthorization";
import AIService, {
  ProjectAiDailyLimitStatus,
} from "../../../../../Server/Services/AIService";
import CodeRepositoryService from "../../../../../Server/Services/CodeRepositoryService";
import DataSecurityCustomDataTypeService from "../../../../../Server/Services/DataSecurityCustomDataTypeService";
import DataSecurityIssueFeedService from "../../../../../Server/Services/DataSecurityIssueFeedService";
import DataSecurityIssueService from "../../../../../Server/Services/DataSecurityIssueService";
import DataStoreAccessService from "../../../../../Server/Services/DataStoreAccessService";
import DataStoreFindingService from "../../../../../Server/Services/DataStoreFindingService";
import DataStoreService from "../../../../../Server/Services/DataStoreService";
import DatabaseService from "../../../../../Server/Services/DatabaseService";
import LlmLogService from "../../../../../Server/Services/LlmLogService";
import LlmProviderService from "../../../../../Server/Services/LlmProviderService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import AiContextReader from "../../../../../Server/Utils/AI/AiContext/AiContextReader";
import CodeFixReadiness from "../../../../../Server/Utils/AI/CodeFix/CodeFixReadiness";
import CodeRepositoryRunnerChoice, {
  CodeRepositoryRunnerStatus,
} from "../../../../../Server/Utils/AI/CodeFix/CodeRepositoryRunnerChoice";
import CodeTaskRuns from "../../../../../Server/Utils/AI/CodeTask/CodeTaskRuns";
import DataSecurityAiInput, {
  DataSecurityAiPrompt,
} from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiInput";
import DataSecurityFieldSuggestion from "../../../../../Server/Utils/AI/DataSecurity/FieldSuggestion";
import {
  QueryDataSecurityIssuesTool,
  QueryDataStoreAccessTool,
  QueryDataStoresTool,
} from "../../../../../Server/Utils/AI/Toolbox/DataSecurityTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../../Server/Utils/AI/Toolbox/ToolTypes";
import CodeHostAccess, {
  CodeHostConnectionState,
  CodeHostConnectionSummary,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostAccess";
import DataSecurityFindingWriter from "../../../../../Server/Utils/DataSecurity/DataSecurityFindingWriter";
import DataSecurityRunner from "../../../../../Server/Utils/DataSecurity/DataSecurityRunner";
import { toStoredFieldSuggestionState } from "../../../../../Server/Utils/DataSecurity/FieldSuggestionState";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../../../Server/Utils/Express";
import LLMService, {
  LLMCompletionRequest,
} from "../../../../../Server/Utils/LLM/LLMService";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DataStoreFinding from "../../../../../Models/DatabaseModels/DataStoreFinding";
import LlmLog from "../../../../../Models/DatabaseModels/LlmLog";
import LlmProvider from "../../../../../Models/DatabaseModels/LlmProvider";
import Project from "../../../../../Models/DatabaseModels/Project";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import CodeRepositoryType from "../../../../../Types/CodeRepository/CodeRepositoryType";
import { DATA_SECURITY_API_ROUTES } from "../../../../../Types/DataSecurity/DataSecurityApiTypes";
import {
  DATA_SECURITY_AI_FEATURES,
  DataSecurityAiFeature,
  DataSecurityAiFeatureInfo,
} from "../../../../../Types/DataSecurity/DataSecurityAiFeatures";
import LlmType from "../../../../../Types/LLM/LlmType";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import { CodeRepositoryRunnerChoiceKind } from "../../../../../Types/Runner/CodeRepositoryRunner";
import { customDomainCaller } from "../../../API/CustomDomainCallers";
import DashboardRequestsOverHttp, {
  SentRequest,
} from "../../../TestingUtils/DashboardRequestsOverHttp";
import {
  StoredRow,
  useInMemoryTable,
} from "../../../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../../../TestingUtils/RequestPlan";
import { everyServerProductIsOn } from "../../../TestingUtils/ServerProductsOn";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * A VALUE PLANTED IN EVERY COLUMN THAT HOLDS ONE NEVER REACHES ONEUPTIME AI
 * (#10365).
 *
 * The issue says it outright: plant a masked sample, a record and a
 * connection string on an issue, and find none of them in any feature's
 * input. So here a store, its issues, its findings and who can reach it are
 * rows held in memory with a value planted in every column that holds one
 * - a finding's masked samples and the records it was seen in, the store's
 * connection string, a cloud connection's secret, a log's body - and each
 * Data Security AI feature runs its real path over them:
 *
 *   - Explain with AI and Fix with AI over HTTP, through the routes, the
 *     permission layer, the reads for AI and the builder, to the model
 *     (LLMService) and to the Code task (CodeTaskRuns.start);
 *   - the field suggestions, from the store's scan state to the model;
 *   - Ask AI's three Data Security tools, to the text the chat reads.
 *
 * Every byte each one sends is searched for every planted value. A
 * feature added to DATA_SECURITY_AI_FEATURES without a run here fails, and
 * the search itself is shown to find a planted value in a prompt that
 * carries one.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10365000-0000-4000-8000-000000000001",
);
const STORE_ID: string = "10365000-0000-4000-8000-0000000000b1";
const TELEMETRY_STORE_ID: string = "10365000-0000-4000-8000-0000000000b2";
const BUCKET_ISSUE_ID: string = "10365000-0000-4000-8000-0000000000a1";
const TELEMETRY_ISSUE_ID: string = "10365000-0000-4000-8000-0000000000a2";
const INFRA_ID: string = "10365000-0000-4000-8000-0000000000c1";
const RUN_ID: ObjectID = new ObjectID("10365000-0000-4000-8000-0000000000f1");

// The planted values: what a record keeps of the data, and the secrets.
const PLANTED: Readonly<Record<string, string>> = {
  maskedSample: "PLANTED-MASKED-j***@e******.com",
  maskedCard: "PLANTED-MASKED-****-****-****-4242",
  sampleRecordTrace: "PLANTED-RECORD-4bf92f3577b34da6a3ce929d0e0e4736",
  sampleRecordLog: "PLANTED-RECORD-LOG-0192f1a0",
  connectionString:
    "postgres://planted_user:PLANTED-PASSWORD@orders-db.internal:5432/orders",
  logBody: "PLANTED-LOG-BODY user=alice@example.com card=4111111111111111",
  cloudSecret: "PLANTED-CLOUD-SECRET",
  description: "PLANTED-DESCRIPTION a person wrote",
  scanCursor: "PLANTED-SCAN-CURSOR",
  acceptedReason: "PLANTED-ACCEPTED-REASON",
  suppressedReason: "PLANTED-SUPPRESSED-REASON",
};

// What each feature sent: every message, request and tool result.
function plantedIn(sent: string): Array<string> {
  return Object.entries(PLANTED)
    .filter(([, planted]: [string, string]): boolean => {
      return sent.includes(planted) || sent.includes(planted.slice(0, 16));
    })
    .map(([name]: [string, string]): string => {
      return name;
    });
}

// The store, with what holds a value planted.
function storeRow(id: string, data: Partial<StoredRow> = {}): StoredRow {
  return {
    _id: id,
    projectId: PROJECT_ID.toString(),
    name: "acme-card-exports",
    kind: "AWS S3 Bucket",
    provider: "aws",
    region: "eu-north-1",
    environment: "Production",
    sensitivity: "Restricted",
    providerResourceId: "arn:aws:s3:::acme-card-exports",
    dataTypeIds: ["credit-card-number", "email-address"],
    exposure: "Public",
    riskScore: 91,
    openIssueCount: 2,
    isArchived: false,
    connectionString: PLANTED["connectionString"],
    description: PLANTED["description"],
    contentScanState: { cursor: PLANTED["scanCursor"] },
    ...data,
  };
}

function issueRows(): Array<StoredRow> {
  return [
    {
      _id: BUCKET_ISSUE_ID,
      projectId: PROJECT_ID.toString(),
      title: "Anyone on the internet can read it",
      checkId: "public-read",
      checkGroup: "Exposure",
      evidence: "The bucket policy grants s3:GetObject to Principal *.",
      severity: "Critical",
      status: "Open",
      riskScore: 91,
      dataTypeIds: ["credit-card-number"],
      dataStoreId: STORE_ID,
      acceptedReason: PLANTED["acceptedReason"],
      dataStore: storeRow(STORE_ID),
    },
    {
      _id: TELEMETRY_ISSUE_ID,
      projectId: PROJECT_ID.toString(),
      title: "Sensitive data is reaching your telemetry",
      checkId: "sensitive-data-in-telemetry",
      checkGroup: "Telemetry",
      evidence: "1 kind of sensitive data is not scrubbed: Email address.",
      severity: "High",
      status: "Open",
      riskScore: 70,
      dataTypeIds: ["email-address"],
      dataStoreId: TELEMETRY_STORE_ID,
      dataStore: storeRow(TELEMETRY_STORE_ID, {
        name: "checkout · Logs",
        kind: "Telemetry Logs",
        provider: "oneuptime",
      }),
    },
  ];
}

function findingRows(): Array<StoredRow> {
  return [
    {
      _id: "10365000-0000-4000-8000-0000000000d1",
      projectId: PROJECT_ID.toString(),
      dataStoreId: TELEMETRY_STORE_ID,
      dataTypeId: "email-address",
      dataTypeName: "Email address",
      location: "attributes.user.email",
      locationKind: "Attribute",
      confidence: "High",
      matchCount: 41,
      valueCount: 50,
      distinctValues: 33,
      isScrubbed: false,
      isSuppressed: false,
      isConfirmed: false,
      isAiSuggested: false,
      lastSeenAt: new Date(),
      maskedSamples: [PLANTED["maskedSample"]],
      sampleRecords: [
        {
          time: new Date().toISOString(),
          traceId: PLANTED["sampleRecordTrace"],
          logId: PLANTED["sampleRecordLog"],
        },
      ],
      suppressedReason: PLANTED["suppressedReason"],
      // A record's body, where no column should hold one.
      body: PLANTED["logBody"],
    },
    {
      _id: "10365000-0000-4000-8000-0000000000d2",
      projectId: PROJECT_ID.toString(),
      dataStoreId: STORE_ID,
      dataTypeId: "credit-card-number",
      dataTypeName: "Card number",
      location: "exports/*.csv",
      locationKind: "Object pattern",
      confidence: "High",
      matchCount: 120,
      valueCount: 200,
      distinctValues: 118,
      isScrubbed: false,
      isSuppressed: false,
      isAiSuggested: false,
      lastSeenAt: new Date(),
      maskedSamples: [PLANTED["maskedCard"]],
    },
    {
      // An AI suggestion a person has not judged, as field suggestions read.
      _id: "10365000-0000-4000-8000-0000000000d3",
      projectId: PROJECT_ID.toString(),
      dataStoreId: STORE_ID,
      dataTypeId: "email-address",
      location: "public.customers.kontakt",
      locationKind: "Column",
      confidence: "Low",
      isAiSuggested: true,
      isConfirmed: false,
      isSuppressed: false,
      maskedSamples: [PLANTED["maskedSample"]],
    },
  ];
}

function accessRows(): Array<StoredRow> {
  return [
    {
      _id: "10365000-0000-4000-8000-0000000000e1",
      projectId: PROJECT_ID.toString(),
      dataStoreId: STORE_ID,
      principal: "arn:aws:iam::210987654321:role/partner",
      principalName: "partner",
      principalType: "Role",
      accessLevel: "Read",
      grantedVia: "Bucket policy",
      isExternal: true,
      isPublic: false,
      isSeenInTraces: false,
      accessKey: PLANTED["cloudSecret"],
    },
  ];
}

const asService: <T extends BaseModel>(
  service: unknown,
) => DatabaseService<T> = <T extends BaseModel>(
  service: unknown,
): DatabaseService<T> => {
  return service as DatabaseService<T>;
};

function passSessionGuards(): void {
  jest.spyOn(UserMiddleware, "getUserMiddleware").mockImplementation((async (
    _req: ExpressRequest,
    _res: ExpressResponse,
    next: NextFunction,
  ) => {
    next();
  }) as never);
  jest
    .spyOn(UserMiddleware, "requireUserAuthentication")
    .mockImplementation((async (
      _req: ExpressRequest,
      _res: ExpressResponse,
      next: NextFunction,
    ) => {
      next();
    }) as never);
}

const OWNER: DatabaseCommonInteractionProps = {
  ...customDomainCaller({
    permissions: [Permission.ProjectOwner],
    projectId: PROJECT_ID,
  }),
  ...ON_HIGHEST_PLAN,
};

let server: DashboardRequestsOverHttp;
let completion: SpyInstance<typeof LLMService.getCompletion>;
let started: SpyInstance<typeof CodeTaskRuns.start>;

// Every message the model was sent, as text.
function sentToTheModel(): string {
  return completion.mock.calls
    .map((call: Array<unknown>): string => {
      return JSON.stringify((call[0] as LLMCompletionRequest).messages);
    })
    .join("\n");
}

beforeAll(async () => {
  passSessionGuards();
  server = new DashboardRequestsOverHttp();
  await server.start([new DataSecurityAPI().getRouter()]);
});

afterAll(async () => {
  await server.stop();
});

beforeEach(() => {
  server.requests.length = 0;
  everyServerProductIsOn();

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return OWNER;
    });

  useInMemoryTable(asService(DataSecurityIssueService), issueRows());
  useInMemoryTable(asService(DataStoreFindingService), findingRows());
  useInMemoryTable(asService(DataStoreService), [
    storeRow(STORE_ID, {
      fieldSuggestionState: toStoredFieldSuggestionState({
        pending: [
          {
            location: "public.customers.kundennr",
            locationKind: "Column",
            neighbours: ["name", "email"],
            shapes: [{ shape: "AA-999999", share: 1 }],
            valueCount: 40,
            averageLength: 9,
          },
        ],
        answers: {},
      }),
    }),
    storeRow(TELEMETRY_STORE_ID, {
      name: "checkout · Logs",
      kind: "Telemetry Logs",
      provider: "oneuptime",
    }),
  ]);
  // Written as one statement the tables in memory do not run: what it saves is no input.
  jest
    .spyOn(DataStoreService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);
  useInMemoryTable(asService(DataStoreAccessService), accessRows());
  useInMemoryTable(asService(DataSecurityCustomDataTypeService), []);
  useInMemoryTable(asService(LlmLogService), []);
  useInMemoryTable(asService(CodeRepositoryService), [
    {
      _id: INFRA_ID,
      projectId: PROJECT_ID.toString(),
      name: "infra",
      repositoryHostedAt: CodeRepositoryType.GitHub,
      organizationName: "acme",
      repositoryName: "infra",
      mainBranchName: "main",
      labels: [],
    },
  ]);

  jest.spyOn(AiContextReader, "read").mockResolvedValue(null);
  jest
    .spyOn(DataSecurityIssueFeedService, "createDataSecurityIssueFeedItem")
    .mockResolvedValue(undefined);
  jest.spyOn(Queue, "addJob").mockResolvedValue(undefined as never);

  // OneUptime AI on, with the project's own model.
  jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
    id: PROJECT_ID,
    enableAi: true,
  } as unknown as Project);
  jest.spyOn(LlmProviderService, "getProviderForChat").mockResolvedValue({
    id: ObjectID.generate(),
    name: "The project's provider",
    llmType: LlmType.Ollama,
    baseUrl: "http://ollama.internal:11434",
    modelName: "llama3.1",
    isGlobalLlm: false,
  } as unknown as LlmProvider);
  completion = jest.spyOn(LLMService, "getCompletion").mockResolvedValue({
    content: '{"fields":[]}',
    usage: { promptTokens: 300, completionTokens: 20, totalTokens: 320 },
  });

  // What a Code task's gate reads: a connected repository, a Runner, room left.
  jest
    .spyOn(CodeHostAccess, "getConnectionSummaries")
    .mockImplementation(
      async (data: {
        repositoryIds: Array<ObjectID>;
      }): Promise<Map<string, CodeHostConnectionSummary>> => {
        return new Map(
          data.repositoryIds.map(
            (id: ObjectID): [string, CodeHostConnectionSummary] => {
              return [
                id.toString(),
                {
                  connectionId: null,
                  provider: CodeRepositoryType.GitHub,
                  hostUrl: null,
                  hostProduct: null,
                  accountLogin: "acme",
                  credentialHint: null,
                  state: CodeHostConnectionState.Connected,
                  isReachableFromServer: true,
                },
              ];
            },
          ),
        );
      },
    );
  jest
    .spyOn(CodeFixReadiness, "getLlmProviderCheck")
    .mockImplementation(async () => {
      return {
        id: "llmProvider",
        ok: true,
        title: "An LLM provider is available",
        detail: "",
      } as never;
    });
  jest
    .spyOn(AIService, "getReachedProjectDailyLimit")
    .mockImplementation(async (): Promise<ProjectAiDailyLimitStatus | null> => {
      return null;
    });
  jest
    .spyOn(CodeRepositoryRunnerChoice, "getStatusForRepository")
    .mockImplementation(async (): Promise<CodeRepositoryRunnerStatus> => {
      return {
        decision: { kind: CodeRepositoryRunnerChoiceKind.Global },
        isOnline: true,
      };
    });
  started = jest
    .spyOn(CodeTaskRuns, "start")
    .mockImplementation(async (): Promise<AIRun> => {
      return new AIRun(RUN_ID);
    });

  // A field suggestion's setup, and what it writes.
  jest.spyOn(DataSecurityRunner, "getScanSetup").mockImplementation((async () => {
    return {
      setting: { disabledDataTypeIds: [] },
      options: {},
      customTypes: new Map(),
    };
  }) as never);
  jest
    .spyOn(DataSecurityFindingWriter, "recordFieldSuggestions")
    .mockResolvedValue(0);
});

afterEach(() => {
  jest.restoreAllMocks();
  passSessionGuards();
});

async function post(route: string, body: JSONObject = {}): Promise<SentRequest> {
  return await server.request("POST", `/api${route}`, body);
}

// Each feature's run over the planted rows, and everything it sent.
const RUNS: Record<DataSecurityAiFeature, () => Promise<string>> = {
  [DataSecurityAiFeature.ExplainIssue]: async (): Promise<string> => {
    for (const issueId of [BUCKET_ISSUE_ID, TELEMETRY_ISSUE_ID]) {
      const sent: SentRequest = await post(
        DATA_SECURITY_API_ROUTES.explainIssue(issueId),
      );

      expect(sent.status).toBe(200);
    }

    expect(completion).toHaveBeenCalledTimes(2);

    return sentToTheModel();
  },
  [DataSecurityAiFeature.FixIssue]: async (): Promise<string> => {
    for (const issueId of [BUCKET_ISSUE_ID, TELEMETRY_ISSUE_ID]) {
      const sent: SentRequest = await post(
        DATA_SECURITY_API_ROUTES.fixIssueWithAi(issueId),
      );

      expect(sent.status).toBe(200);
    }

    expect(started).toHaveBeenCalledTimes(2);

    return started.mock.calls
      .map((call: Array<unknown>): string => {
        return JSON.stringify(call[0]);
      })
      .join("\n");
  },
  [DataSecurityAiFeature.SuggestFieldTypes]: async (): Promise<string> => {
    await DataSecurityFieldSuggestion.suggestForStore({
      projectId: PROJECT_ID,
      dataStoreId: new ObjectID(STORE_ID),
    });

    expect(completion).toHaveBeenCalledTimes(1);

    return sentToTheModel();
  },
  [DataSecurityAiFeature.AskAi]: async (): Promise<string> => {
    const ctx: ToolContext = { projectId: PROJECT_ID, props: { isRoot: true } };
    const results: Array<ToolExecutionResult> = [
      await QueryDataStoresTool.execute({}, ctx),
      await QueryDataStoresTool.execute({ dataStoreId: STORE_ID }, ctx),
      await QueryDataStoresTool.execute(
        { dataStoreId: TELEMETRY_STORE_ID },
        ctx,
      ),
      await QueryDataSecurityIssuesTool.execute({}, ctx),
      await QueryDataSecurityIssuesTool.execute(
        { dataSecurityIssueId: TELEMETRY_ISSUE_ID },
        ctx,
      ),
      /*
       * A principal's reach is read with a text search the tables in
       * memory do not answer; its row is the builder's
       * (reachableStoreRow), planted in DataSecurityAiInput.test.ts.
       */
      await QueryDataStoreAccessTool.execute({ dataStoreId: STORE_ID }, ctx),
    ];

    return results
      .map((result: ToolExecutionResult): string => {
        return result.dataForLlm;
      })
      .join("\n");
  },
};

// What each feature is for, which its input must still carry.
const WHAT_EACH_SENDS: Record<DataSecurityAiFeature, Array<string>> = {
  [DataSecurityAiFeature.ExplainIssue]: [
    "acme-card-exports",
    "attributes.user.email",
    "The bucket policy grants s3:GetObject",
  ],
  [DataSecurityAiFeature.FixIssue]: [
    "acme-card-exports",
    "attributes.user.email",
    "Open a pull request.",
  ],
  [DataSecurityAiFeature.SuggestFieldTypes]: [
    "public.customers.kundennr",
    "AA-999999",
  ],
  [DataSecurityAiFeature.AskAi]: [
    "acme-card-exports",
    "attributes.user.email",
    "arn:aws:iam::210987654321:role/partner",
  ],
};

describe("no feature's input carries a value planted where a record keeps one", () => {
  test("every Data Security AI feature has a run here", () => {
    expect(Object.keys(RUNS).sort()).toEqual(
      DATA_SECURITY_AI_FEATURES.map((info: DataSecurityAiFeatureInfo): string => {
        return info.feature;
      }).sort(),
    );
  });

  test.each(Object.keys(RUNS))("%s", async (feature: string) => {
    const sent: string = await RUNS[feature as DataSecurityAiFeature]();

    expect({ feature, planted: plantedIn(sent) }).toEqual({
      feature,
      planted: [],
    });
    // It sent what it is for.
    for (const fact of WHAT_EACH_SENDS[feature as DataSecurityAiFeature]) {
      expect({ feature, fact, sent: sent.includes(fact) }).toEqual({
        feature,
        fact,
        sent: true,
      });
    }
  });

  test("the reads for AI never even select what holds a value", async () => {
    const issueReads: SpyInstance = jest.spyOn(
      DataSecurityIssueService,
      "findOneBy",
    );
    const findingReads: SpyInstance = jest.spyOn(
      DataStoreFindingService,
      "findBy",
    );

    await RUNS[DataSecurityAiFeature.ExplainIssue]();
    await RUNS[DataSecurityAiFeature.FixIssue]();

    const selects: string = [...issueReads.mock.calls, ...findingReads.mock.calls]
      .map((call: Array<unknown>): string => {
        return JSON.stringify((call[0] as { select?: unknown }).select || {});
      })
      .join("\n");

    for (const column of [
      "maskedSamples",
      "sampleRecords",
      "connectionString",
      "secrets",
      "description",
      "acceptedReason",
      "suppressedReason",
    ]) {
      expect({ column, selected: selects.includes(`"${column}"`) }).toEqual({
        column,
        selected: false,
      });
    }
  });
});

/*
 * The search itself: a prompt that carries a planted value is found out.
 * A feature built without the builder - its finding's samples joined into
 * the message - is what the guard and this test exist to stop.
 */
describe("the search finds a planted value in a prompt that carries one", () => {
  test("a masked sample, a record, a connection string and a log's body", () => {
    const finding: DataStoreFinding = new DataStoreFinding();
    finding.maskedSamples = [PLANTED["maskedSample"]!];
    finding.sampleRecords = [
      { time: "2026-11-20T10:00:00.000Z", traceId: PLANTED["sampleRecordTrace"] },
    ];

    const leaky: string = JSON.stringify([
      { role: "system", content: "Explain it." },
      {
        role: "user",
        content: `Samples: ${finding.maskedSamples.join(", ")}. Seen in ${JSON.stringify(finding.sampleRecords)}. Database: ${PLANTED["connectionString"]}. Body: ${PLANTED["logBody"]}`,
      },
    ]);

    expect(plantedIn(leaky)).toEqual([
      "maskedSample",
      "sampleRecordTrace",
      "connectionString",
      "logBody",
    ]);
  });

  test("the same finding through the builder carries none of them", () => {
    const finding: DataStoreFinding = new DataStoreFinding();
    finding.dataTypeId = "email-address";
    finding.location = "attributes.user.email";
    finding.maskedSamples = [PLANTED["maskedSample"]!];

    const prompt: DataSecurityAiPrompt =
      DataSecurityAiInput.buildExplainIssuePrompt({
        instructions: "Explain it.",
        issue: { checkId: "sensitive-data-in-telemetry" },
        findings: [finding],
      });

    expect(plantedIn(JSON.stringify(prompt.messages))).toEqual([]);
    expect(JSON.stringify(prompt.messages)).toContain("attributes.user.email");
  });
});

// An AI Logs row of these runs keeps none of it either.
describe("and the AI Logs keep none of it", () => {
  test("Explain's and the field suggestions' rows", async () => {
    const logs: SpyInstance = jest.spyOn(LlmLogService, "create");

    await RUNS[DataSecurityAiFeature.ExplainIssue]();
    await DataSecurityFieldSuggestion.suggestForStore({
      projectId: PROJECT_ID,
      dataStoreId: new ObjectID(STORE_ID),
    });

    const kept: string = logs.mock.calls
      .map((call: Array<unknown>): string => {
        return JSON.stringify((call[0] as { data: LlmLog }).data);
      })
      .join("\n");

    expect(logs.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(plantedIn(kept)).toEqual([]);
    expect(kept).not.toContain("acme-card-exports");
    expect(kept).not.toContain("attributes.user.email");
  });
});
