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
  LLM_LOG_PREVIEW_NOT_KEPT,
  LLM_LOG_PROVIDER_ERROR_WITHOUT_DETAILS,
} from "../../../Server/Services/AIService";
import DataSecurityCustomDataTypeService from "../../../Server/Services/DataSecurityCustomDataTypeService";
import DataSecurityIssueFeedService from "../../../Server/Services/DataSecurityIssueFeedService";
import DataSecurityIssueService from "../../../Server/Services/DataSecurityIssueService";
import DataStoreFindingService from "../../../Server/Services/DataStoreFindingService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import LlmLogService from "../../../Server/Services/LlmLogService";
import LlmProviderService from "../../../Server/Services/LlmProviderService";
import ProjectService from "../../../Server/Services/ProjectService";
import AiContextReader from "../../../Server/Utils/AI/AiContext/AiContextReader";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import LLMService, {
  LLMCompletionRequest,
} from "../../../Server/Utils/LLM/LLMService";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import LlmLog from "../../../Models/DatabaseModels/LlmLog";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import Project from "../../../Models/DatabaseModels/Project";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { DATA_SECURITY_API_ROUTES } from "../../../Types/DataSecurity/DataSecurityApiTypes";
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
 * EXPLAIN WITH AI, AND THE AI LOGS, THROUGH THE SERVER'S OWN ROUTES (#10361).
 *
 * A Security Admin pressed Explain with AI on "Anyone on the internet can
 * read it" for the bucket acme-card-exports. A Project Member with no
 * Security role then opened Project Settings > AI > AI Logs, or called
 * /llm-log, and read the bucket's name, its cloud id and region, that it
 * holds card numbers, the evidence that it is public, and the fix. The
 * docs say the opposite: other roles see none of it.
 *
 * Here the explain route and the AI Logs' CRUD route run as the App serves
 * them - Express, the routes' permission checks, BaseAPI and the
 * permission layer, AIService.executeWithLogging and LlmLogService writing
 * the AI Logs row - over HTTP, into tables held in memory. Only the model
 * (LLMService) and its provider are stood in for. For every role the
 * issue's story names: who may explain the issue, and what each reads in
 * the AI Logs afterwards - never the issue, nor the answer.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10361000-0000-4000-8000-000000000001",
);
const ISSUE_ID: string = "10361000-0000-4000-8000-0000000000a1";
const STORE_ID: string = "10361000-0000-4000-8000-0000000000b1";

const BUCKET: string = "acme-card-exports";
const CLOUD_ID: string = "arn:aws:s3:::acme-card-exports";
const REGION: string = "eu-north-1";
const EVIDENCE: string =
  "The bucket policy grants s3:GetObject to Principal * on acme-card-exports.";
const ANSWER: string = `Anyone can download the card numbers in ${BUCKET} (${REGION}). Turn on Block Public Access for ${CLOUD_ID}, then remove the policy statement that grants s3:GetObject to *.`;

// What the AI Logs must never hold of the issue, or of the answer.
const SECRETS: Array<string> = [BUCKET, CLOUD_ID, REGION, "s3:GetObject"];

const PERMISSION_MESSAGE: string =
  "You do not have permission to do this in Data Security.";

interface Role {
  name: string;
  permissions: Array<Permission>;
  // Reads the issue, so may have OneUptime AI explain it.
  mayExplain: boolean;
  // Reads the project's AI Logs.
  readsAiLogs: boolean;
}

// The roles the issue names: the project's own and the Security ones.
const ROLES: Array<Role> = [
  {
    name: "a project owner",
    permissions: [Permission.ProjectOwner],
    mayExplain: true,
    readsAiLogs: true,
  },
  {
    name: "a project admin",
    permissions: [Permission.ProjectAdmin],
    mayExplain: true,
    readsAiLogs: true,
  },
  {
    name: "a project member",
    permissions: [Permission.ProjectMember],
    mayExplain: false,
    readsAiLogs: true,
  },
  {
    name: "a viewer",
    permissions: [Permission.Viewer],
    mayExplain: false,
    readsAiLogs: true,
  },
  {
    name: "a security admin",
    permissions: [Permission.SecurityAdmin],
    mayExplain: true,
    readsAiLogs: false,
  },
  {
    name: "a security member",
    permissions: [Permission.SecurityMember],
    mayExplain: true,
    readsAiLogs: false,
  },
  {
    name: "a security viewer",
    permissions: [Permission.SecurityViewer],
    mayExplain: true,
    readsAiLogs: false,
  },
  {
    name: "a custom role that reads the AI Logs",
    permissions: [Permission.ReadLlmLog],
    mayExplain: false,
    readsAiLogs: true,
  },
  {
    name: "a custom role that reads data stores, not their issues",
    permissions: [Permission.ReadDataStore],
    mayExplain: false,
    readsAiLogs: false,
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
let completion: SpyInstance<typeof LLMService.getCompletion>;

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

  everyServerProductIsOn();
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return caller;
    });

  useInMemoryTable(asService(DataSecurityIssueService), [storedIssue()]);
  useInMemoryTable(asService(DataStoreFindingService), []);
  useInMemoryTable(asService(DataSecurityCustomDataTypeService), []);
  logs = useInMemoryTable(asService(LlmLogService), []);

  jest.spyOn(AiContextReader, "read").mockResolvedValue(null);
  jest
    .spyOn(DataSecurityIssueFeedService, "createDataSecurityIssueFeedItem")
    .mockResolvedValue(undefined);

  // The project, with OneUptime AI on and its own provider.
  jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
    id: PROJECT_ID,
    enableAi: true,
  } as unknown as Project);
  jest.spyOn(LlmProviderService, "getProviderForChat").mockResolvedValue({
    id: ObjectID.generate(),
    name: "The project's provider",
    llmType: LlmType.OpenAI,
    modelName: "chat-large",
    isGlobalLlm: false,
  } as unknown as LlmProvider);
  completion = jest.spyOn(LLMService, "getCompletion").mockResolvedValue({
    content: ANSWER,
    usage: { promptTokens: 600, completionTokens: 80, totalTokens: 680 },
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

async function explainAs(role: Array<Permission>): Promise<SentRequest> {
  caller = callerWith(role);

  return await server.request(
    "POST",
    `/api${DATA_SECURITY_API_ROUTES.explainIssue(ISSUE_ID)}`,
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

describe("who may have OneUptime AI explain an issue", () => {
  test.each(ROLES)(
    "$name: explained only when they may read the issue",
    async (role: Role) => {
      const sent: SentRequest = await explainAs(role.permissions);

      if (role.mayExplain) {
        expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
          status: 200,
          refusal: "",
        });
        // The person who asked reads the answer, and the issue's timeline keeps it.
        expect(((sent.answer || {}) as JSONObject)["markdown"]).toBe(ANSWER);
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

describe("what each role reads in the AI Logs once a Security Admin explained an issue", () => {
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
