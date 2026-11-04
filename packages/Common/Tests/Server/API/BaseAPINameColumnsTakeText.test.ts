import BaseAPI from "../../../Server/API/BaseAPI";
import DatabaseService from "../../../Server/Services/DatabaseService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import {
  ExpressResponse,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import { mockRouter } from "./Helpers";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import AIAgent from "../../../Models/DatabaseModels/AIAgent";
import AuditLogExport from "../../../Models/DatabaseModels/AuditLogExport";
import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ExceptionSavedView from "../../../Models/DatabaseModels/ExceptionSavedView";
import ExternalMcpServer from "../../../Models/DatabaseModels/ExternalMcpServer";
import LlmCostBudget from "../../../Models/DatabaseModels/LlmCostBudget";
import LlmObservabilityConnection from "../../../Models/DatabaseModels/LlmObservabilityConnection";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import LogDropFilter from "../../../Models/DatabaseModels/LogDropFilter";
import LogPipeline from "../../../Models/DatabaseModels/LogPipeline";
import LogPipelineProcessor from "../../../Models/DatabaseModels/LogPipelineProcessor";
import LogRecordingRule from "../../../Models/DatabaseModels/LogRecordingRule";
import LogSavedView from "../../../Models/DatabaseModels/LogSavedView";
import LogScrubRule from "../../../Models/DatabaseModels/LogScrubRule";
import MetricPipelineRule from "../../../Models/DatabaseModels/MetricPipelineRule";
import MetricRecordingRule from "../../../Models/DatabaseModels/MetricRecordingRule";
import MetricSavedView from "../../../Models/DatabaseModels/MetricSavedView";
import NetworkControllerConnection from "../../../Models/DatabaseModels/NetworkControllerConnection";
import Probe from "../../../Models/DatabaseModels/Probe";
import SecurityEventConnection from "../../../Models/DatabaseModels/SecurityEventConnection";
import SecurityEventDestination from "../../../Models/DatabaseModels/SecurityEventDestination";
import SecurityPlaybook from "../../../Models/DatabaseModels/SecurityPlaybook";
import SecurityPlaybookRun from "../../../Models/DatabaseModels/SecurityPlaybookRun";
import ThreatIntelFeed from "../../../Models/DatabaseModels/ThreatIntelFeed";
import TraceDropFilter from "../../../Models/DatabaseModels/TraceDropFilter";
import TracePipeline from "../../../Models/DatabaseModels/TracePipeline";
import TracePipelineProcessor from "../../../Models/DatabaseModels/TracePipelineProcessor";
import TraceRecordingRule from "../../../Models/DatabaseModels/TraceRecordingRule";
import TraceSavedView from "../../../Models/DatabaseModels/TraceSavedView";
import TraceScrubRule from "../../../Models/DatabaseModels/TraceScrubRule";
import User from "../../../Models/DatabaseModels/User";
import VideoCallConnection from "../../../Models/DatabaseModels/VideoCallConnection";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import { getJestSpyOn } from "../../Spy";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
  };
});

/*
 * POST and PUT /<model>: a thing's name - a cloud connection's, a probe's,
 * an LLM provider's, a pipeline's, a saved view's... - is text. Sent as
 * text, it reaches the service as that text, as it always did. Sent as the
 * person's-name object the API's schema used to ask for,
 * {"_type":"Name","value":"..."}, it reaches the service as the text it
 * holds too - never as a Name, which the column would have stored as its
 * JSON. A person's name (a user's) keeps its Name, as before.
 */

const TEST_ID: string = "550e8400-e29b-41d4-a716-4466554400c2";

type ModelType = { new (): BaseModel };

interface NameCase {
  modelType: ModelType;
  column: string;
}

// Every column moved off the Name type (NameColumnsArePeoplesNames).
const CASES: Array<NameCase> = [
  { modelType: AIAgent, column: "name" },
  { modelType: AuditLogExport, column: "name" },
  { modelType: CloudConnection, column: "name" },
  { modelType: ExternalMcpServer, column: "name" },
  { modelType: LogDropFilter, column: "name" },
  { modelType: ExceptionSavedView, column: "name" },
  { modelType: LlmObservabilityConnection, column: "name" },
  { modelType: LogPipeline, column: "name" },
  { modelType: LlmCostBudget, column: "name" },
  { modelType: MetricSavedView, column: "name" },
  { modelType: Probe, column: "name" },
  { modelType: Probe, column: "description" },
  { modelType: LogSavedView, column: "name" },
  { modelType: LogRecordingRule, column: "name" },
  { modelType: SecurityEventConnection, column: "name" },
  { modelType: MetricRecordingRule, column: "name" },
  { modelType: TraceRecordingRule, column: "name" },
  { modelType: VideoCallConnection, column: "name" },
  { modelType: SecurityEventDestination, column: "name" },
  { modelType: SecurityPlaybook, column: "name" },
  { modelType: TraceSavedView, column: "name" },
  { modelType: TracePipelineProcessor, column: "name" },
  { modelType: TraceScrubRule, column: "name" },
  { modelType: TracePipeline, column: "name" },
  { modelType: LogPipelineProcessor, column: "name" },
  { modelType: LlmProvider, column: "name" },
  { modelType: LogScrubRule, column: "name" },
  { modelType: NetworkControllerConnection, column: "name" },
  { modelType: MetricPipelineRule, column: "name" },
  { modelType: SecurityPlaybookRun, column: "playbookName" },
  { modelType: ThreatIntelFeed, column: "name" },
  { modelType: TraceDropFilter, column: "name" },
];

// A name as long as the person's-name type allowed, and one longer.
const TEXT: string = "Production AWS (us-east-1)";
const LONG_TEXT: string = "Production AWS read by the organization's role";

function makeApi(modelType: ModelType): {
  api: BaseAPI<BaseModel, DatabaseService<BaseModel>>;
  service: DatabaseService<BaseModel>;
} {
  const service: DatabaseService<BaseModel> = new DatabaseService<BaseModel>(
    modelType,
  );

  return {
    service,
    api: new BaseAPI<BaseModel, DatabaseService<BaseModel>>(modelType, service),
  };
}

function makeResponse(): ExpressResponse {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;
}

async function updatedValue(
  nameCase: NameCase,
  value: unknown,
): Promise<unknown> {
  const { api, service } = makeApi(nameCase.modelType);
  const updateSpy: jest.Mock = getJestSpyOn(
    service,
    "updateOneById",
  ).mockResolvedValue(1) as unknown as jest.Mock;

  await api.updateItem(
    {
      params: { id: TEST_ID },
      body: { data: { [nameCase.column]: value } as JSONObject },
      headers: {},
    } as unknown as OneUptimeRequest,
    makeResponse(),
  );

  return (
    (updateSpy.mock.calls[0] as Array<unknown>)[0] as { data: JSONObject }
  ).data[nameCase.column];
}

async function createdValue(
  nameCase: NameCase,
  value: unknown,
): Promise<unknown> {
  const { api, service } = makeApi(nameCase.modelType);
  const createSpy: jest.Mock = getJestSpyOn(
    service,
    "create",
  ).mockResolvedValue(
    new nameCase.modelType() as never,
  ) as unknown as jest.Mock;

  await api.createItem(
    {
      params: {},
      body: { data: { [nameCase.column]: value } },
      headers: {},
    } as unknown as OneUptimeRequest,
    makeResponse(),
  );

  const createBy: CreateBy<BaseModel> = createSpy.mock
    .calls[0]![0] as CreateBy<BaseModel>;

  return (createBy.data as unknown as Record<string, unknown>)[nameCase.column];
}

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("a thing's name, sent as text or as the old Name object", () => {
  for (const nameCase of CASES) {
    describe(`${nameCase.modelType.name}.${nameCase.column}`, () => {
      it("POST: text reaches the service as that text", async () => {
        await expect(createdValue(nameCase, TEXT)).resolves.toBe(TEXT);
        await expect(createdValue(nameCase, LONG_TEXT)).resolves.toBe(
          LONG_TEXT,
        );
      });

      it("POST: the Name object reaches the service as its text", async () => {
        await expect(
          createdValue(nameCase, { _type: ObjectType.Name, value: TEXT }),
        ).resolves.toBe(TEXT);
      });

      it("PUT: text reaches the service as that text", async () => {
        await expect(updatedValue(nameCase, TEXT)).resolves.toBe(TEXT);
      });

      it("PUT: the Name object reaches the service as its text", async () => {
        await expect(
          updatedValue(nameCase, { _type: ObjectType.Name, value: TEXT }),
        ).resolves.toBe(TEXT);
      });
    });
  }
});

describe("a person's name keeps its Name", () => {
  const userName: NameCase = { modelType: User, column: "name" };

  it("POST: the Name object reaches the service as a Name, as before", async () => {
    const value: unknown = await createdValue(userName, {
      _type: ObjectType.Name,
      value: "Maya Lopez",
    });

    expect(value).toBeInstanceOf(Name);
    expect((value as Name).toString()).toBe("Maya Lopez");
  });

  it("PUT: the Name object reaches the service as a Name, as before", async () => {
    const value: unknown = await updatedValue(userName, {
      _type: ObjectType.Name,
      value: "Maya Lopez",
    });

    expect(value).toBeInstanceOf(Name);
  });

  it("text stays text for the Name transformer to read", async () => {
    await expect(createdValue(userName, "Maya Lopez")).resolves.toBe(
      "Maya Lopez",
    );
    await expect(updatedValue(userName, "Maya Lopez")).resolves.toBe(
      "Maya Lopez",
    );
  });
});
