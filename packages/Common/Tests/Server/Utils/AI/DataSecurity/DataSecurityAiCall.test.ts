import AIService, {
  AI_DATA_SECURITY_FIELD_SUGGESTION_FEATURE,
  AI_DATA_SECURITY_FINDING_VERDICTS_FEATURE,
  AI_DATA_SECURITY_ISSUE_ANALYSIS_FEATURE,
  AI_DATA_SECURITY_ISSUE_EXPLANATION_FEATURE,
  AI_DATA_SECURITY_ISSUE_GROUP_NAME_FEATURE,
  AI_DATA_SECURITY_PULL_REQUEST_REVIEW_FEATURE,
  AI_DATA_SECURITY_SCRUB_RULES_FEATURE,
  AI_DATA_SECURITY_STORE_OWNERS_FEATURE,
  AILogRequest,
  LLM_LOG_PREVIEW_NOT_KEPT,
} from "../../../../../Server/Services/AIService";
import LlmLogService from "../../../../../Server/Services/LlmLogService";
import LlmProviderService from "../../../../../Server/Services/LlmProviderService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import DataSecurityAiCall, {
  DATA_SECURITY_AI_CALL_LABELS,
} from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiCall";
import DataSecurityAiInput, {
  AiIssueDossier,
  DataSecurityAiPrompt,
} from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiInput";
import { buildIssueAnalysisPrompt } from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityIssuePrompt";
import { buildFieldSuggestionPrompt } from "../../../../../Server/Utils/AI/DataSecurity/FieldSuggestionPrompt";
import LLMService, {
  LLMCompletionRequest,
} from "../../../../../Server/Utils/LLM/LLMService";
import LlmLog from "../../../../../Models/DatabaseModels/LlmLog";
import LlmProvider from "../../../../../Models/DatabaseModels/LlmProvider";
import Project from "../../../../../Models/DatabaseModels/Project";
import {
  DATA_SECURITY_AI_FEATURES,
  DataSecurityAiFeature,
  DataSecurityAiFeatureInfo,
  DataSecurityAiModelSource,
} from "../../../../../Types/DataSecurity/DataSecurityAiFeatures";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import LlmType from "../../../../../Types/LLM/LlmType";
import ObjectID from "../../../../../Types/ObjectID";
import SecuritySeverity from "../../../../../Types/SecuritySeverity";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * THE ONE WAY A DATA SECURITY FEATURE ASKS ONEUPTIME AI (#10365).
 *
 * DataSecurityAiCall takes only a prompt DataSecurityAiInput made, files it
 * under its feature's label, keeps nothing of it in the AI Logs or on its
 * span, and runs on the project's own model: an AI rule's pick (#10364),
 * else the project's default provider - a self-hosted one included - else
 * the server's global one, the Helm chart's bundled vLLM on an air-gapped
 * server. Here through the real AIService.executeWithLogging and the real
 * provider resolution; only the database rows and the model are stood in
 * for.
 */

jest.mock("../../../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  return { ...actual, IsBillingEnabled: false };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "10365000-0000-4000-8000-000000000001",
);

// The project's own model, on its own network.
const SELF_HOSTED: LlmProvider = {
  _id: "10365000-0000-4000-8000-0000000000c1",
  id: new ObjectID("10365000-0000-4000-8000-0000000000c1"),
  name: "Our Ollama",
  llmType: LlmType.Ollama,
  baseUrl: "http://ollama.internal:11434",
  modelName: "llama3.1:70b",
  isGlobalLlm: false,
  isDefault: true,
  projectId: PROJECT_ID,
} as unknown as LlmProvider;

// The server's own, the Helm chart's bundled vLLM: no project owns it.
const BUNDLED_VLLM: LlmProvider = {
  _id: "10365000-0000-4000-8000-0000000000c2",
  id: new ObjectID("10365000-0000-4000-8000-0000000000c2"),
  name: "OneUptime vLLM",
  llmType: LlmType.OpenAICompatible,
  baseUrl: "http://oneuptime-vllm:8000/v1",
  modelName: "qwen2.5-32b-instruct",
  isGlobalLlm: true,
} as unknown as LlmProvider;

// One an AI rule picks for its work (#10364).
const RULE_PICK: LlmProvider = {
  _id: "10365000-0000-4000-8000-0000000000c3",
  id: new ObjectID("10365000-0000-4000-8000-0000000000c3"),
  name: "Security's vLLM",
  llmType: LlmType.OpenAICompatible,
  baseUrl: "http://security-vllm.internal:8000/v1",
  modelName: "security-large",
  isGlobalLlm: false,
  isDefault: false,
  projectId: PROJECT_ID,
} as unknown as LlmProvider;

// A person's analysis of an issue (#10369), as the issue's page asks for it.
function explainPrompt(): DataSecurityAiPrompt {
  const dossier: AiIssueDossier = {
    issue: {
      checkId: "public-read",
      title: "Anyone on the internet can read it",
      severity: SecuritySeverity.Critical,
      evidence: "The bucket policy grants s3:GetObject to *.",
    },
    store: { name: "acme-card-exports", kind: DataStoreKind.AwsS3Bucket },
    places: [],
    access: [],
    copies: [],
    securityCaseIds: [],
    responses: [],
    proposals: [],
    declaredCode: null,
    owners: { recordIds: [], names: [], count: 0 },
    now: new Date("2026-11-20T12:00:00.000Z"),
  };

  return buildIssueAnalysisPrompt({
    feature: DataSecurityAiFeature.ExplainIssue,
    dossier,
    language: "en",
  });
}

function fieldPrompt(): DataSecurityAiPrompt {
  return buildFieldSuggestionPrompt({
    storeKind: "PostgreSQL",
    dataTypes: [{ id: "email-address", name: "Email address" }],
    fields: [
      {
        location: "public.users.mail",
        locationKind: "Column",
        neighbours: ["name"],
        shapes: [{ shape: "aaaa@aaaa.aaa", share: 1 }],
        valueCount: 20,
        averageLength: 14,
      },
    ],
  });
}

let providers: Array<LlmProvider>;
let getCompletion: jest.SpyInstance;
let createLog: jest.SpyInstance;

// What the model was sent.
function sent(): LLMCompletionRequest {
  return getCompletion.mock.calls[0]![0] as LLMCompletionRequest;
}

function savedLog(): LlmLog {
  return (createLog.mock.calls[0]![0] as { data: LlmLog }).data;
}

beforeEach(() => {
  providers = [SELF_HOSTED, BUNDLED_VLLM, RULE_PICK];

  jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
    id: PROJECT_ID,
    enableAi: true,
  } as unknown as Project);

  // The provider rows, answered by the query the real resolution makes.
  jest.spyOn(LlmProviderService, "findOneBy").mockImplementation((async (args: {
    query: Record<string, unknown>;
  }): Promise<LlmProvider | null> => {
    const query: Record<string, unknown> = args.query;

    if (query["_id"]) {
      return (
        providers.find((provider: LlmProvider): boolean => {
          return provider._id === String(query["_id"]);
        }) || null
      );
    }

    if (query["isDefault"] === true) {
      return (
        providers.find((provider: LlmProvider): boolean => {
          return (
            provider.isDefault === true &&
            provider.projectId?.toString() === PROJECT_ID.toString()
          );
        }) || null
      );
    }

    if (query["isGlobalLlm"] === true) {
      return (
        providers.find((provider: LlmProvider): boolean => {
          return provider.isGlobalLlm === true;
        }) || null
      );
    }

    return null;
  }) as never);

  getCompletion = jest.spyOn(LLMService, "getCompletion").mockResolvedValue({
    content: "The bucket is public. Turn on Block Public Access.",
    usage: { promptTokens: 300, completionTokens: 20, totalTokens: 320 },
  });
  createLog = jest
    .spyOn(LlmLogService, "create")
    .mockResolvedValue(new LlmLog());
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what every Data Security call keeps", () => {
  test("no preview, no provider error, no telemetry content; its feature's label; the prompt's messages", async () => {
    const executed: jest.SpyInstance = jest.spyOn(
      AIService,
      "executeWithLogging",
    );
    const prompt: DataSecurityAiPrompt = explainPrompt();

    await DataSecurityAiCall.ask({
      projectId: PROJECT_ID,
      userId: ObjectID.generate(),
      prompt,
      maxTokens: 900,
    });

    const request: AILogRequest = executed.mock.calls[0]![0] as AILogRequest;

    expect(request).toMatchObject({
      projectId: PROJECT_ID,
      feature: AI_DATA_SECURITY_ISSUE_EXPLANATION_FEATURE,
      storeContentPreviews: false,
      storeErrorDetails: false,
      recordContentInTelemetry: false,
      maxTokens: 900,
    });
    expect(request.messages).toBe(prompt.messages);
    expect(sent().messages).toEqual(prompt.messages);
    expect(sent().includeProviderErrorDetails).toBe(false);
    expect(savedLog().requestPrompt).toBe(LLM_LOG_PREVIEW_NOT_KEPT);
    expect(savedLog().responsePreview).toBe(LLM_LOG_PREVIEW_NOT_KEPT);
    expect(savedLog().feature).toBe(AI_DATA_SECURITY_ISSUE_EXPLANATION_FEATURE);
  });

  test("each feature that calls a model files its calls under its own label", async () => {
    const executed: jest.SpyInstance = jest.spyOn(
      AIService,
      "executeWithLogging",
    );

    await DataSecurityAiCall.ask({
      projectId: PROJECT_ID,
      prompt: fieldPrompt(),
      maxTokens: 3000,
    });

    expect((executed.mock.calls[0]![0] as AILogRequest).feature).toBe(
      AI_DATA_SECURITY_FIELD_SUGGESTION_FEATURE,
    );
    expect(DATA_SECURITY_AI_CALL_LABELS).toEqual({
      [DataSecurityAiFeature.ExplainIssue]:
        AI_DATA_SECURITY_ISSUE_EXPLANATION_FEATURE,
      // OneUptime AI's own analysis of a new issue (#10364): autonomous, so budgeted.
      [DataSecurityAiFeature.AnalyzeIssue]:
        AI_DATA_SECURITY_ISSUE_ANALYSIS_FEATURE,
      [DataSecurityAiFeature.SuggestFieldTypes]:
        AI_DATA_SECURITY_FIELD_SUGGESTION_FEATURE,
      // Its verdicts on the findings that wait for a person (#10372): autonomous, so budgeted.
      [DataSecurityAiFeature.JudgeFindings]:
        AI_DATA_SECURITY_FINDING_VERDICTS_FEATURE,
      // OneUptime AI's owners for a store (#10374): autonomous, so budgeted.
      [DataSecurityAiFeature.ProposeStoreOwners]:
        AI_DATA_SECURITY_STORE_OWNERS_FEATURE,
      // A group of issues' name, after each grouping (#10370): autonomous, so budgeted.
      [DataSecurityAiFeature.NameIssueGroup]:
        AI_DATA_SECURITY_ISSUE_GROUP_NAME_FEATURE,
      // OneUptime AI's scrub rules for what Scrub It cannot cover (#10366): autonomous, so budgeted.
      [DataSecurityAiFeature.WriteScrubRules]:
        AI_DATA_SECURITY_SCRUB_RULES_FEATURE,
      // Its read of a pull request's sensitive data (#10376): autonomous, so budgeted.
      [DataSecurityAiFeature.ReviewPullRequests]:
        AI_DATA_SECURITY_PULL_REQUEST_REVIEW_FEATURE,
    });
  });

  test("a failed call keeps the provider's words out of the AI Logs and of what is thrown", async () => {
    getCompletion.mockRejectedValue(
      new Error(
        'could not parse messages[1].content: {"store":{"name":"acme-card-exports"}}',
      ),
    );

    const error: unknown = await DataSecurityAiCall.ask({
      projectId: PROJECT_ID,
      prompt: explainPrompt(),
      maxTokens: 900,
    }).catch((thrown: unknown): unknown => {
      return thrown;
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).not.toContain("acme-card-exports");
    expect(savedLog().statusMessage).not.toContain("acme-card-exports");
  });
});

describe("it takes only a prompt DataSecurityAiInput made", () => {
  test("a lookalike is refused before anything is sent", async () => {
    const lookalike: unknown = {
      feature: DataSecurityAiFeature.ExplainIssue,
      instructions: "Explain it.",
      data: {},
      textThatReadsLikeInstructions: [],
      messages: [{ role: "user", content: "j***@e******.com" }],
    };

    await expect(
      DataSecurityAiCall.ask({
        projectId: PROJECT_ID,
        prompt: lookalike as DataSecurityAiPrompt,
        maxTokens: 900,
      }),
    ).rejects.toThrow(BadDataException);
    expect(getCompletion).not.toHaveBeenCalled();
    expect(createLog).not.toHaveBeenCalled();
  });

  test("a feature that does not call a model itself is refused", async () => {
    await expect(
      DataSecurityAiCall.ask({
        projectId: PROJECT_ID,
        prompt: { ...explainPrompt(), feature: DataSecurityAiFeature.FixIssue },
        maxTokens: 900,
      }),
    ).rejects.toThrow("does not call a model itself");
    expect(getCompletion).not.toHaveBeenCalled();
  });
});

/*
 * YOUR OWN MODEL (#10365, item 5): Data Security's AI follows the AI rule's
 * provider, then the project's default - a self-hosted Ollama, vLLM or any
 * OpenAI-compatible endpoint included - and on an air-gapped server the
 * bundled vLLM, so nothing leaves it.
 */
describe("every call runs on the project's own model", () => {
  test.each([
    ["Explain with AI", explainPrompt],
    ["the field suggestions", fieldPrompt],
  ])(
    "%s runs on the project's self-hosted default provider",
    async (_feature: string, prompt: () => DataSecurityAiPrompt) => {
      await DataSecurityAiCall.ask({
        projectId: PROJECT_ID,
        prompt: prompt(),
        maxTokens: 900,
      });

      expect(sent().llmProviderConfig).toEqual({
        llmType: LlmType.Ollama,
        baseUrl: "http://ollama.internal:11434",
        modelName: "llama3.1:70b",
      });
      expect(savedLog().llmProviderName).toBe("Our Ollama");
      expect(savedLog().isGlobalProvider).toBe(false);
    },
  );

  test("with no provider of its own, the server's bundled vLLM: an operator's, reached on its private address", async () => {
    providers = [BUNDLED_VLLM];

    await DataSecurityAiCall.ask({
      projectId: PROJECT_ID,
      prompt: explainPrompt(),
      maxTokens: 900,
    });

    expect(sent().llmProviderConfig).toEqual({
      llmType: LlmType.OpenAICompatible,
      baseUrl: "http://oneuptime-vllm:8000/v1",
      modelName: "qwen2.5-32b-instruct",
      isGlobalProvider: true,
    });
  });

  test("the provider an AI rule picks, ahead of the project's default", async () => {
    await DataSecurityAiCall.ask({
      projectId: PROJECT_ID,
      prompt: explainPrompt(),
      maxTokens: 900,
      rulePickedProviderId: RULE_PICK._id,
    });

    expect(sent().llmProviderConfig).toMatchObject({
      llmType: LlmType.OpenAICompatible,
      baseUrl: "http://security-vllm.internal:8000/v1",
      modelName: "security-large",
    });
    expect(savedLog().llmProviderName).toBe("Security's vLLM");
  });

  test("a pick the project may not use falls back to its own default", async () => {
    await DataSecurityAiCall.ask({
      projectId: PROJECT_ID,
      prompt: explainPrompt(),
      maxTokens: 900,
      rulePickedProviderId: "10365000-0000-4000-8000-00000000dead",
    });

    expect(sent().llmProviderConfig).toMatchObject({
      llmType: LlmType.Ollama,
      baseUrl: "http://ollama.internal:11434",
    });
  });

  test("with no pick, nothing more is read than every call reads", async () => {
    const findOneBy: jest.SpyInstance = LlmProviderService.findOneBy as never;

    await DataSecurityAiCall.ask({
      projectId: PROJECT_ID,
      prompt: explainPrompt(),
      maxTokens: 900,
    });

    // The project's default, and no rule's pick.
    expect(
      findOneBy.mock.calls.some((call: Array<unknown>): boolean => {
        return Boolean(
          (call[0] as { query: Record<string, unknown> }).query["_id"],
        );
      }),
    ).toBe(false);
  });

  test("the features that reach a model through their own runs resolve the project's own provider too", async () => {
    // Fix with AI: the coding agent's completions, on the metered agent path.
    expect(
      await LlmProviderService.getLlmProviderForMeteredAgentPath(PROJECT_ID),
    ).toBe(SELF_HOSTED);

    // Ask AI: the chat's provider, with none picked in the chat.
    expect(
      await LlmProviderService.getProviderForChat({ projectId: PROJECT_ID }),
    ).toBe(SELF_HOSTED);

    const sources: Array<DataSecurityAiModelSource> =
      DATA_SECURITY_AI_FEATURES.map(
        (info: DataSecurityAiFeatureInfo): DataSecurityAiModelSource => {
          return info.modelSource;
        },
      );

    expect(sources).toEqual([
      DataSecurityAiModelSource.ProjectProvider,
      DataSecurityAiModelSource.ProjectProvider,
      DataSecurityAiModelSource.CodeAgent,
      DataSecurityAiModelSource.ProjectProvider,
      // Verdicts on findings (#10372): the one Data Security call, as the suggestions'.
      DataSecurityAiModelSource.ProjectProvider,
      DataSecurityAiModelSource.Chat,
      // Owners for data stores: the one Data Security call, as Explain's.
      DataSecurityAiModelSource.ProjectProvider,
      // A group's name (#10370): the one Data Security call too.
      DataSecurityAiModelSource.ProjectProvider,
      // A group's one pull request: the coding agent, as Fix with AI's.
      DataSecurityAiModelSource.CodeAgent,
      // Scrub rules for what Scrub It cannot cover (#10366): the same one call.
      DataSecurityAiModelSource.ProjectProvider,
      // A pull request's sensitive data: the repository's pick for its reviews.
      DataSecurityAiModelSource.ProductionReview,
    ]);
  });
});

describe("the prompts it is handed are the builder's", () => {
  test("Explain's and the field suggestions' are", () => {
    expect(DataSecurityAiInput.isDataSecurityAiPrompt(explainPrompt())).toBe(
      true,
    );
    expect(DataSecurityAiInput.isDataSecurityAiPrompt(fieldPrompt())).toBe(
      true,
    );
  });
});
