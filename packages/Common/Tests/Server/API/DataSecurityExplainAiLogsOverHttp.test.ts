jest.mock("../../../Server/Utils/Logger", () => {
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

import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import DataSecurityAPI from "../../../Server/API/DataSecurityAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import {
  AI_DATA_SECURITY_ISSUE_EXPLANATION_FEATURE,
  AI_DISABLED_MESSAGE,
  LLM_LOG_PREVIEW_NOT_KEPT,
  LLM_LOG_PROVIDER_ERROR_WITHOUT_DETAILS,
} from "../../../Server/Services/AIService";
import DataSecurityAiProposalService from "../../../Server/Services/DataSecurityAiProposalService";
import DataSecurityCustomDataTypeService from "../../../Server/Services/DataSecurityCustomDataTypeService";
import DataSecurityFlowService from "../../../Server/Services/DataSecurityFlowService";
import DataSecurityIssueFeedService from "../../../Server/Services/DataSecurityIssueFeedService";
import DataSecurityIssueService from "../../../Server/Services/DataSecurityIssueService";
import DataStoreAccessService from "../../../Server/Services/DataStoreAccessService";
import DataStoreFindingService from "../../../Server/Services/DataStoreFindingService";
import DataStoreOwnerTeamService from "../../../Server/Services/DataStoreOwnerTeamService";
import DataStoreOwnerUserService from "../../../Server/Services/DataStoreOwnerUserService";
import DataStoreService from "../../../Server/Services/DataStoreService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import LlmLogService from "../../../Server/Services/LlmLogService";
import LlmProviderService from "../../../Server/Services/LlmProviderService";
import ProjectService from "../../../Server/Services/ProjectService";
import AiContextReader from "../../../Server/Utils/AI/AiContext/AiContextReader";
import DataSecurityResponse from "../../../Server/Utils/DataSecurity/DataSecurityResponse";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import LLMService, {
  LLMCompletionRequest,
} from "../../../Server/Utils/LLM/LLMService";
import ProjectLanguage from "../../../Server/Utils/Notification/ProjectLanguage";
import UserLanguage from "../../../Server/Utils/Notification/UserLanguage";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { DataSecurityIssueFeedEventType } from "../../../Models/DatabaseModels/DataSecurityIssueFeed";
import LlmLog from "../../../Models/DatabaseModels/LlmLog";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import Project from "../../../Models/DatabaseModels/Project";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { DATA_SECURITY_API_ROUTES } from "../../../Types/DataSecurity/DataSecurityApiTypes";
import {
  DataSecurityAiVerdict,
  DataSecurityAnalysisFactSource,
  DataSecurityIssueAnalysisView,
  readDataSecurityIssueAnalysis,
  readDataSecurityIssueAnalysisView,
} from "../../../Types/DataSecurity/DataSecurityIssueAnalysis";
import { DataSecurityResponseAction } from "../../../Types/DataSecurity/DataSecurityResponseAction";
import { JSONObject } from "../../../Types/JSON";
import LlmType from "../../../Types/LLM/LlmType";
import LlmLogStatus from "../../../Types/LlmLogStatus";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { customDomainCaller } from "./CustomDomainCallers";
import DashboardRequestsOverHttp, {
  SentRequest,
} from "../TestingUtils/DashboardRequestsOverHttp";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { everyServerProductIsOn } from "../TestingUtils/ServerProductsOn";
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
 * ONEUPTIME AI'S ANALYSIS OF AN ISSUE, AND THE AI LOGS, THROUGH THE SERVER'S
 * OWN ROUTES (#10361, #10369).
 *
 * A Security Admin pressed Explain with AI on "Anyone on the internet can
 * read it" for the bucket acme-card-exports. A Project Member with no
 * Security role then opened Project Settings > AI > AI Logs, or called
 * /llm-log, and read the bucket's name, its cloud id and region, that it
 * holds card numbers, the evidence that it is public, and the fix. The
 * docs say the opposite: other roles see none of it.
 *
 * Explain with AI is OneUptime AI's analysis now (#10369): written from
 * what Data Security knows about the issue - its store, who can reach it,
 * the response that contains it - held to the facts it names, kept on the
 * issue and read back by each person as they may read what it rests on.
 *
 * Here the explain and analysis routes and the AI Logs' CRUD route run as
 * the App serves them - Express, the routes' permission checks, BaseAPI and
 * the permission layer, the analysis's own reads, AIService
 * .executeWithLogging and LlmLogService writing the AI Logs row - over
 * HTTP, into tables held in memory. Only the model (LLMService) and its
 * provider are stood in for. For every role the issues' stories name: who
 * may have the issue analyzed, what each reads of the analysis, and what
 * each reads in the AI Logs afterwards - never the issue, nor the answer.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10361000-0000-4000-8000-000000000001",
);
const ISSUE_ID: string = "10361000-0000-4000-8000-0000000000a1";
const STORE_ID: string = "10361000-0000-4000-8000-0000000000b1";
const ACCESS_ID: string = "10361000-0000-4000-8000-0000000000c1";
const ROLE_ACCESS_ID: string = "10361000-0000-4000-8000-0000000000c2";

const BUCKET: string = "acme-card-exports";
const CLOUD_ID: string = "arn:aws:s3:::acme-card-exports";
const REGION: string = "eu-north-1";
const EVIDENCE: string =
  "The bucket policy grants s3:GetObject to Principal * on acme-card-exports.";

// OneUptime AI's answer: a verdict, and each line with the facts it rests on.
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

// What the AI Logs must never hold of the issue, or of the answer.
const SECRETS: Array<string> = [BUCKET, CLOUD_ID, REGION, "s3:GetObject"];

const PERMISSION_MESSAGE: string =
  "You do not have permission to do this in Data Security.";

interface Role {
  name: string;
  permissions: Array<Permission>;
  // Reads the issue, so may have OneUptime AI analyze it.
  mayExplain: boolean;
  // Reads the project's AI Logs.
  readsAiLogs: boolean;
  // Reads who can reach the store: the analysis's lines that rest on it.
  readsAccess: boolean;
}

// The roles the issues name: the project's own and the Security ones.
const ROLES: Array<Role> = [
  {
    name: "a project owner",
    permissions: [Permission.ProjectOwner],
    mayExplain: true,
    readsAiLogs: true,
    readsAccess: true,
  },
  {
    name: "a project admin",
    permissions: [Permission.ProjectAdmin],
    mayExplain: true,
    readsAiLogs: true,
    readsAccess: true,
  },
  {
    name: "a project member",
    permissions: [Permission.ProjectMember],
    mayExplain: false,
    readsAiLogs: true,
    readsAccess: false,
  },
  {
    name: "a viewer",
    permissions: [Permission.Viewer],
    mayExplain: false,
    readsAiLogs: true,
    readsAccess: false,
  },
  {
    name: "a security admin",
    permissions: [Permission.SecurityAdmin],
    mayExplain: true,
    readsAiLogs: false,
    readsAccess: true,
  },
  {
    name: "a security member",
    permissions: [Permission.SecurityMember],
    mayExplain: true,
    readsAiLogs: false,
    readsAccess: true,
  },
  {
    name: "a security viewer",
    permissions: [Permission.SecurityViewer],
    mayExplain: true,
    readsAiLogs: false,
    readsAccess: true,
  },
  {
    name: "a custom role that reads the AI Logs",
    permissions: [Permission.ReadLlmLog],
    mayExplain: false,
    readsAiLogs: true,
    readsAccess: false,
  },
  {
    name: "a custom role that reads data stores, not their issues",
    permissions: [Permission.ReadDataStore],
    mayExplain: false,
    readsAiLogs: false,
    readsAccess: false,
  },
  {
    // The analysis's lines that rest on who can reach the store are not theirs (#10369).
    name: "a custom role that reads issues and their stores, not who can reach them",
    permissions: [Permission.ReadDataSecurityIssue, Permission.ReadDataStore],
    mayExplain: true,
    readsAiLogs: false,
    readsAccess: false,
  },
];

function callerWith(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions: permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

function storedIssue(): StoredRow {
  return {
    _id: ISSUE_ID,
    projectId: PROJECT_ID.toString(),
    title: "Anyone on the internet can read it",
    checkId: "public-read",
    evidence: EVIDENCE,
    severity: "Critical",
    status: "Open",
    dataTypeIds: ["credit-card-number"],
    dataStoreId: STORE_ID,
    dataStore: {
      _id: STORE_ID,
      name: BUCKET,
      kind: "AWS S3 Bucket",
      region: REGION,
      sensitivity: "Restricted",
      providerResourceId: CLOUD_ID,
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
    region: REGION,
    sensitivity: "Restricted",
    providerResourceId: CLOUD_ID,
    dataTypeIds: ["credit-card-number"],
    exposure: "Public",
    estimatedRecords: 12_345,
    isPublicByDesign: false,
    isArchived: false,
  };
}

// Everyone may read the bucket, through its policy.
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

const asService: <T extends BaseModel>(
  service: unknown,
) => DatabaseService<T> = <T extends BaseModel>(
  service: unknown,
): DatabaseService<T> => {
  return service as DatabaseService<T>;
};

let server: DashboardRequestsOverHttp;
let caller: DatabaseCommonInteractionProps;
let logs: InMemoryTable;
let issues: InMemoryTable;
let access: InMemoryTable;
let enableAi: boolean;
let completion: SpyInstance<typeof LLMService.getCompletion>;
let feed: SpyInstance<
  typeof DataSecurityIssueFeedService.createDataSecurityIssueFeedItem
>;

beforeAll(async () => {
  // The session guards, as a signed-in member passes them.
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

  server = new DashboardRequestsOverHttp();
  await server.start([
    new DataSecurityAPI().getRouter(),
    // The App serves the AI Logs as it serves every model: BaseAPI.
    new BaseAPI<LlmLog, DatabaseService<LlmLog>>(
      LlmLog,
      asService<LlmLog>(LlmLogService),
    ).getRouter(),
  ]);
});

afterAll(async () => {
  await server.stop();
});

beforeEach(() => {
  server.requests.length = 0;
  caller = callerWith([Permission.SecurityAdmin]);
  enableAi = true;

  everyServerProductIsOn();
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return caller;
    });

  issues = useInMemoryTable(asService(DataSecurityIssueService), [
    storedIssue(),
  ]);
  useInMemoryTable(asService(DataStoreFindingService), []);
  useInMemoryTable(asService(DataSecurityCustomDataTypeService), []);
  logs = useInMemoryTable(asService(LlmLogService), []);
  // What the analysis reads of the issue's store (#10369).
  useInMemoryTable(asService(DataStoreService), [storedStore()]);
  access = useInMemoryTable(asService(DataStoreAccessService), [publicGrant()]);
  useInMemoryTable(asService(DataSecurityFlowService), []);
  useInMemoryTable(asService(DataSecurityAiProposalService), []);
  useInMemoryTable(asService(DataStoreOwnerUserService), []);
  useInMemoryTable(asService(DataStoreOwnerTeamService), []);
  // Block Public Access can run from the issue's page: the store's connection allows it.
  jest.spyOn(DataSecurityResponse, "getAvailability").mockResolvedValue({
    actions: [
      {
        action: DataSecurityResponseAction.BlockPublicAccess,
        isAvailable: true,
      },
    ],
  });
  jest.spyOn(UserLanguage, "getLanguage").mockResolvedValue("en");
  jest.spyOn(ProjectLanguage, "getLanguage").mockResolvedValue("en");
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

  jest.spyOn(AiContextReader, "read").mockResolvedValue(null);
  feed = jest
    .spyOn(DataSecurityIssueFeedService, "createDataSecurityIssueFeedItem")
    .mockResolvedValue(undefined);

  // The project, with OneUptime AI on - unless a test turns it off - and its own provider.
  jest.spyOn(ProjectService, "findOneById").mockImplementation((async () => {
    return { id: PROJECT_ID, enableAi } as unknown as Project;
  }) as never);
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
});

afterEach(() => {
  jest.restoreAllMocks();

  // The session guards stay as the routers were built with them.
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
});

async function explainAs(
  role: Array<Permission>,
  body: JSONObject = {},
): Promise<SentRequest> {
  caller = callerWith(role);

  return await server.request(
    "POST",
    `/api${DATA_SECURITY_API_ROUTES.explainIssue(ISSUE_ID)}`,
    body,
  );
}

async function readAnalysisAs(role: Array<Permission>): Promise<SentRequest> {
  caller = callerWith(role);

  return await server.request(
    "POST",
    `/api${DATA_SECURITY_API_ROUTES.issueAnalysis(ISSUE_ID)}`,
    {},
  );
}

async function readAiLogsAs(role: Array<Permission>): Promise<SentRequest> {
  caller = callerWith(role);

  return await server.request("POST", "/api/llm-log/get-list", {
    query: {},
    select: {
      _id: true,
      feature: true,
      status: true,
      statusMessage: true,
      requestPrompt: true,
      responsePreview: true,
    },
    limit: 10,
    skip: 0,
  });
}

function refusalOf(sent: SentRequest): string {
  const answer: JSONObject = (sent.answer || {}) as JSONObject;
  return String(answer["error"] || answer["message"] || "");
}

function rowsOf(sent: SentRequest): Array<JSONObject> {
  return (((sent.answer || {}) as JSONObject)["data"] ||
    []) as Array<JSONObject>;
}

// The analysis a route answered, read as the Dashboard reads it.
function analysisOf(sent: SentRequest): DataSecurityIssueAnalysisView | null {
  return readDataSecurityIssueAnalysisView(
    ((sent.answer || {}) as JSONObject)["analysis"],
  );
}

describe("who may have OneUptime AI analyze an issue", () => {
  test.each(ROLES)(
    "$name: analyzed only when they may read the issue",
    async (role: Role) => {
      const sent: SentRequest = await explainAs(role.permissions);

      if (role.mayExplain) {
        expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
          status: 200,
          refusal: "",
        });
        // The person who asked reads the analysis, and the issue keeps it.
        expect(analysisOf(sent)?.verdict).toBe(DataSecurityAiVerdict.Real);
        expect(String((sent.answer as JSONObject)["markdown"])).toContain(
          REASON,
        );
        expect(completion).toHaveBeenCalledTimes(1);
        return;
      }

      // NotAuthorizedException, as OneUptime answers every refusal (ExceptionCode).
      expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
        status: 422,
        refusal: PERMISSION_MESSAGE,
      });
      expect(completion).not.toHaveBeenCalled();
      expect(logs.inserts).toEqual([]);
    },
  );
});

describe("OneUptime AI's analysis, written once and read back (#10369)", () => {
  test("is written from what Data Security knows, kept on the issue, and its timeline says its verdict", async () => {
    const sent: SentRequest = await explainAs([Permission.SecurityAdmin]);

    expect(sent.status).toBe(200);
    expect((sent.answer as JSONObject)["isNew"]).toBe(true);

    // What OneUptime AI read: the issue, its store, who can reach it, what contains it.
    const asked: string = JSON.stringify(
      (completion.mock.calls[0]![0] as LLMCompletionRequest).messages,
    );

    expect(asked).toContain("Anyone on the internet can read it");
    expect(asked).toContain("Everyone");
    expect(asked).toContain(DataSecurityResponseAction.BlockPublicAccess);
    expect(asked).not.toContain(ACCESS_ID);
    expect(asked).not.toContain(STORE_ID);

    const row: StoredRow = issues.get(ISSUE_ID)!;

    expect(row["aiVerdict"]).toBe(DataSecurityAiVerdict.Real);
    expect(row["aiAnalysisInputHash"]).toMatch(/^[0-9a-f]{64}$/);
    expect(row["aiAnalyzedAt"]).toBeInstanceOf(Date);
    expect(
      readDataSecurityIssueAnalysis(row["aiAnalysis"])?.lines.risk,
    ).toEqual({ text: RISK, facts: ["S1", "R0", "R1"] });
    // Never the issue's status or severity: its check decides.
    expect(row["status"]).toBe("Open");
    expect(row["severity"]).toBe("Critical");
    expect(feed).toHaveBeenCalledTimes(1);
    expect(feed.mock.calls[0]![0]).toMatchObject({
      eventType: DataSecurityIssueFeedEventType.AiAnalysis,
      feedInfoInMarkdown: "OneUptime AI analyzed this issue: **Real**.",
    });
  });

  test("opening the issue, or asking again with nothing changed, asks OneUptime AI nothing", async () => {
    expect((await explainAs([Permission.SecurityAdmin])).status).toBe(200);

    const opened: SentRequest = await readAnalysisAs([
      Permission.SecurityMember,
    ]);
    const askedAgain: SentRequest = await explainAs([
      Permission.SecurityMember,
    ]);

    expect(analysisOf(opened)?.verdict).toBe(DataSecurityAiVerdict.Real);
    expect((askedAgain.answer as JSONObject)["isNew"]).toBe(false);
    expect(analysisOf(askedAgain)?.lines.reason?.text).toBe(REASON);
    expect(completion).toHaveBeenCalledTimes(1);
    expect(feed).toHaveBeenCalledTimes(1);
  });

  test("Analyze Again asks anyway, and so does a change to what it rests on", async () => {
    expect((await explainAs([Permission.SecurityAdmin])).status).toBe(200);
    expect(
      (await explainAs([Permission.SecurityAdmin], { force: true })).status,
    ).toBe(200);
    expect(completion).toHaveBeenCalledTimes(2);

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

    const changed: SentRequest = await explainAs([Permission.SecurityAdmin]);

    expect((changed.answer as JSONObject)["isNew"]).toBe(true);
    expect(completion).toHaveBeenCalledTimes(3);
    expect(feed.mock.calls[2]![0].feedInfoInMarkdown).toBe(
      "OneUptime AI analyzed this issue again: **Real**.",
    );
  });

  test.each(ROLES)(
    "$name: reads the analysis as they may read what it rests on",
    async (role: Role) => {
      expect((await explainAs([Permission.SecurityAdmin])).status).toBe(200);

      const sent: SentRequest = await readAnalysisAs(role.permissions);

      if (!role.mayExplain) {
        expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
          status: 422,
          refusal: PERMISSION_MESSAGE,
        });
        expect(JSON.stringify(sent.answer)).not.toContain(REASON);
        return;
      }

      const analysis: DataSecurityIssueAnalysisView = analysisOf(sent)!;

      expect(sent.status).toBe(200);
      expect(analysis.verdict).toBe(DataSecurityAiVerdict.Real);
      expect(analysis.lines.reason?.text).toBe(REASON);
      expect(analysis.lines.path?.text).toBe(PATH);

      if (role.readsAccess) {
        expect(analysis.lines.risk?.text).toBe(RISK);
        expect(analysis.lines.breaks?.text).toBe(BREAKS);
        expect(analysis.hiddenLines).toEqual({});
        return;
      }

      // Who can reach the store is not theirs to read: neither the lines nor the grants.
      expect(analysis.lines.risk).toBeUndefined();
      expect(analysis.lines.breaks).toBeUndefined();
      expect(analysis.hiddenLines).toEqual({
        risk: [DataSecurityAnalysisFactSource.Access],
        breaks: [DataSecurityAnalysisFactSource.Access],
      });
      expect(JSON.stringify(sent.answer)).not.toContain("Everyone");
      expect(JSON.stringify(sent.answer)).not.toContain("Bucket policy");
    },
  );

  test("with the project's AI off: no analysis is shown, and none is asked for", async () => {
    expect((await explainAs([Permission.SecurityAdmin])).status).toBe(200);

    enableAi = false;
    completion.mockClear();

    const read: SentRequest = await readAnalysisAs([Permission.SecurityAdmin]);
    const asked: SentRequest = await explainAs([Permission.SecurityAdmin], {
      force: true,
    });

    expect(read.status).toBe(200);
    expect((read.answer as JSONObject)["analysis"]).toBeNull();
    expect(asked.status).toBeGreaterThanOrEqual(400);
    expect(refusalOf(asked)).toBe(AI_DISABLED_MESSAGE);
    expect(completion).not.toHaveBeenCalled();
  });
});

describe("what each role reads in the AI Logs once a Security Admin had an issue analyzed", () => {
  test("the AI Logs row is written, as Explain's, with neither the issue nor the answer", async () => {
    expect((await explainAs([Permission.SecurityAdmin])).status).toBe(200);

    // What OneUptime AI was sent: the issue, in full.
    const sentToModel: LLMCompletionRequest = completion.mock.calls[0]![0];
    expect(JSON.stringify(sentToModel.messages)).toContain(BUCKET);

    expect(logs.inserts).toHaveLength(1);
    expect(logs.inserts[0]).toMatchObject({
      feature: AI_DATA_SECURITY_ISSUE_EXPLANATION_FEATURE,
      status: LlmLogStatus.Success,
      requestPrompt: LLM_LOG_PREVIEW_NOT_KEPT,
      responsePreview: LLM_LOG_PREVIEW_NOT_KEPT,
    });

    for (const secret of SECRETS) {
      expect({
        secret,
        kept: JSON.stringify(logs.rows).includes(secret),
      }).toEqual({ secret, kept: false });
    }
  });

  test.each(ROLES)(
    "$name: reads nothing of the issue or of the answer there",
    async (role: Role) => {
      expect((await explainAs([Permission.SecurityAdmin])).status).toBe(200);

      const sent: SentRequest = await readAiLogsAs(role.permissions);

      if (!role.readsAiLogs) {
        expect(sent.status).toBeGreaterThanOrEqual(400);
        expect(sent.status).toBeLessThan(500);
        expect(rowsOf(sent)).toEqual([]);
        return;
      }

      expect(sent.status).toBe(200);

      const rows: Array<JSONObject> = rowsOf(sent);

      // The row is there - the call happened, and what it cost - and says so.
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        feature: AI_DATA_SECURITY_ISSUE_EXPLANATION_FEATURE,
        requestPrompt: LLM_LOG_PREVIEW_NOT_KEPT,
        responsePreview: LLM_LOG_PREVIEW_NOT_KEPT,
      });

      for (const secret of SECRETS) {
        expect({
          secret,
          read: JSON.stringify(sent.answer).includes(secret),
        }).toEqual({ secret, read: false });
      }
    },
  );

  test("a provider's error that quotes the prompt is kept out of the AI Logs, and out of the answer", async () => {
    completion.mockRejectedValue(
      new Error(
        `400 Bad Request: could not parse messages[1].content "Store: ${BUCKET} (AWS S3 Bucket, ${REGION})"`,
      ),
    );

    const sent: SentRequest = await explainAs([Permission.SecurityAdmin]);

    expect(sent.status).toBeGreaterThanOrEqual(400);
    expect(refusalOf(sent)).toBe(LLM_LOG_PROVIDER_ERROR_WITHOUT_DETAILS);
    expect(logs.inserts).toHaveLength(1);
    expect(logs.inserts[0]).toMatchObject({
      feature: AI_DATA_SECURITY_ISSUE_EXPLANATION_FEATURE,
      status: LlmLogStatus.Error,
      statusMessage: LLM_LOG_PROVIDER_ERROR_WITHOUT_DETAILS,
      requestPrompt: LLM_LOG_PREVIEW_NOT_KEPT,
    });
    // Nothing is kept on the issue of a call that failed.
    expect(issues.get(ISSUE_ID)!["aiAnalysis"]).toBeUndefined();

    const member: SentRequest = await readAiLogsAs([Permission.ProjectMember]);

    expect(member.status).toBe(200);

    for (const secret of SECRETS) {
      expect({
        secret,
        read: JSON.stringify(member.answer).includes(secret),
      }).toEqual({ secret, read: false });
    }
  });
});
