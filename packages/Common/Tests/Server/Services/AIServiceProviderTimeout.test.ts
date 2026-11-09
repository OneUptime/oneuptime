import AIService from "../../../Server/Services/AIService";
import LlmLogService from "../../../Server/Services/LlmLogService";
import LlmProviderService from "../../../Server/Services/LlmProviderService";
import ProjectService from "../../../Server/Services/ProjectService";
import LLMService, {
  LLMProviderConfig,
} from "../../../Server/Utils/LLM/LLMService";
import logger from "../../../Server/Utils/Logger";
import LlmLog from "../../../Models/DatabaseModels/LlmLog";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import Project from "../../../Models/DatabaseModels/Project";
import LlmType from "../../../Types/LLM/LlmType";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * An LLM provider's response timeout reaches every model call to it
 * (issue #6438): AIService hands the provider's requestTimeoutInSeconds to
 * LLMService with the rest of its settings. Without one, nothing is sent
 * and the provider type's default holds.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

let provider: LlmProvider;
let completion: jest.SpyInstance;

function selfHostedProvider(values: Record<string, unknown> = {}): LlmProvider {
  return {
    id: ObjectID.generate(),
    name: "Our vLLM",
    llmType: LlmType.OpenAI,
    baseUrl: "https://llm.example.com/v1",
    modelName: "a-slow-model",
    isGlobalLlm: false,
    costPerMillionTokensInUSDCents: 0,
    ...values,
  } as unknown as LlmProvider;
}

function sentConfig(): LLMProviderConfig {
  return (
    completion.mock.calls[0]![0] as { llmProviderConfig: LLMProviderConfig }
  ).llmProviderConfig;
}

async function askAi(): Promise<void> {
  await AIService.executeWithLogging({
    projectId: PROJECT_ID,
    feature: "Observability Chat",
    messages: [{ role: "user", content: "what broke?" }],
  });
}

beforeEach(() => {
  provider = selfHostedProvider();

  jest.spyOn(logger, "error").mockImplementation((): void => {});
  jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
    id: PROJECT_ID,
    enableAi: true,
  } as unknown as Project);
  jest
    .spyOn(LlmProviderService, "getProviderForChat")
    .mockImplementation(async () => {
      return provider;
    });
  jest
    .spyOn(LlmProviderService, "getLLMProviderForProject")
    .mockImplementation(async () => {
      return provider;
    });
  completion = jest.spyOn(LLMService, "getCompletion").mockResolvedValue({
    content: "the model answered",
    usage: { promptTokens: 10, completionTokens: 0, totalTokens: 10 },
  } as never);
  jest
    .spyOn(LlmLogService, "create")
    .mockImplementation(async (data: { data: LlmLog }) => {
      return data.data;
    });
  // The day's usage, read before each call: nothing used yet.
  jest.spyOn(LlmLogService, "getRepository").mockReturnValue({
    manager: {
      query: async (): Promise<Array<Record<string, unknown>>> => {
        return [
          {
            total: "0",
            totalTokens: "0",
            cacheRead: "0",
            cacheWrite: "0",
            billedCostInUSDCents: "0",
          },
        ];
      },
    },
  } as unknown as ReturnType<typeof LlmLogService.getRepository>);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("AIService and an LLM provider's response timeout", () => {
  test("a provider that waits ten minutes has every call wait ten minutes", async () => {
    provider = selfHostedProvider({ requestTimeoutInSeconds: 600 });

    await askAi();

    expect(sentConfig()).toEqual(
      expect.objectContaining({
        llmType: LlmType.OpenAI,
        modelName: "a-slow-model",
        requestTimeoutInSeconds: 600,
      }),
    );
  });

  test("a provider without one sends none: its type's default holds", async () => {
    await askAi();

    expect(sentConfig()).not.toHaveProperty("requestTimeoutInSeconds");
  });
});
