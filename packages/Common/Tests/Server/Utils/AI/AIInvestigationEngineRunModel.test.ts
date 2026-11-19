import AIInvestigationEngine, {
  getRunModelColumns,
  InvestigationRequest,
} from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import AIConfidenceSignal from "../../../../Server/Utils/AI/SRE/ConfidenceSignal";
import InvestigationTldr from "../../../../Server/Utils/AI/SRE/InvestigationTldr";
import ObservabilityAssistant, {
  ObservabilityAssistantResult,
} from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import LlmProviderChoice from "../../../../Server/Utils/AI/LlmProviderChoice";
import AIRunEventService from "../../../../Server/Services/AIRunEventService";
import AIRunService, {
  AIRunTransitionSet,
} from "../../../../Server/Services/AIRunService";
import AIRunEvent from "../../../../Models/DatabaseModels/AIRunEvent";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import LlmType from "../../../../Types/LLM/LlmType";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import Permission from "../../../../Types/Permission";
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
 * AN INVESTIGATION RECORDS THE MODEL THAT WROTE ITS ANSWER WHEN IT
 * COMPLETES (issue #7762), so AI Results can tell what each model's
 * investigations came to: AIRun.modelName and AIRun.llmProviderType, set
 * in the same Running -> Completed transition that settles the run - never
 * on a run that did not complete, and nothing for a loop whose calls named
 * no model.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

describe("getRunModelColumns", () => {
  test("the model's name, as the provider named it, and its provider's type", () => {
    expect(
      getRunModelColumns({
        modelName: "chat-large",
        providerType: LlmType.Anthropic,
      }),
    ).toEqual({ modelName: "chat-large", llmProviderType: LlmType.Anthropic });
  });

  test("trimmed; a blank name is none", () => {
    expect(getRunModelColumns({ modelName: "  chat-large  " })).toEqual({
      modelName: "chat-large",
    });
    expect(getRunModelColumns({ modelName: "   " })).toEqual({});
    expect(getRunModelColumns({})).toEqual({});
  });

  test("a type OneUptime does not know is not kept", () => {
    expect(
      getRunModelColumns({ modelName: "chat-large", providerType: "Gemini" }),
    ).toEqual({ modelName: "chat-large" });
  });

  test.each(Object.values(LlmType))(
    "every provider type is kept: %s",
    (type: LlmType) => {
      expect(getRunModelColumns({ providerType: type })).toEqual({
        llmProviderType: type,
      });
    },
  );
});

describe("the run's columns", () => {
  test("model name and provider type: written by OneUptime only, read as the run's other counts are", () => {
    const run: AIRun = new AIRun();

    for (const column of ["modelName", "llmProviderType"]) {
      expect(run.getTableColumnMetadata(column)?.type).toBe(
        TableColumnType.ShortText,
      );
      expect(run.getColumnAccessControlFor(column)?.create).toEqual([]);
      expect(run.getColumnAccessControlFor(column)?.update).toEqual([]);
      expect(run.getColumnAccessControlFor(column)?.read).toEqual(
        run.getColumnAccessControlFor("totalTokens")?.read,
      );
      expect(run.getColumnAccessControlFor(column)?.read).toEqual(
        expect.arrayContaining([Permission.ProjectOwner, Permission.Viewer]),
      );
    }
  });
});

describe("AIInvestigationEngine.executeRun records the model that wrote the answer", () => {
  const aiRunId: ObjectID = ObjectID.generate();
  let transition: SpyInstance<typeof AIRunService.attemptStatusTransition>;
  let answer: SpyInstance<typeof ObservabilityAssistant.answerQuestion>;

  function result(
    overrides: Partial<ObservabilityAssistantResult> = {},
  ): ObservabilityAssistantResult {
    return {
      contentInMarkdown:
        "**Summary** — shop-api saturated the CPU of web-1.\n\n**Most likely root cause** — a CPU-bound container.",
      citations: [],
      totalTokens: 100,
      llmCallCount: 2,
      toolCallCount: 3,
      ...overrides,
    };
  }

  function request(): InvestigationRequest {
    return {
      feature: "AI Incident Investigation",
      incidentId: INCIDENT_ID,
      contextSummary: "# Incident\nTitle: Shop is down",
      persistAnalysisTldr: true,
      postAnalysis: async (): Promise<void> => {
        return undefined;
      },
    };
  }

  function completion(): AIRunTransitionSet {
    const call:
      | Parameters<typeof AIRunService.attemptStatusTransition>[0]
      | undefined = transition.mock.calls
      .map((args: Parameters<typeof AIRunService.attemptStatusTransition>) => {
        return args[0];
      })
      .find(
        (
          args: Parameters<typeof AIRunService.attemptStatusTransition>[0],
        ): boolean => {
          return args.set.status === AIRunStatus.Completed;
        },
      );

    if (!call) {
      throw new Error("The run never completed.");
    }

    return call.set;
  }

  async function run(): Promise<void> {
    await AIInvestigationEngine.executeRun({
      aiRunId,
      projectId: PROJECT_ID,
      attemptCount: 1,
      request: request(),
    });
  }

  beforeEach(() => {
    jest
      .spyOn(AIRunEventService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(AIRunEventService, "create")
      .mockImplementation(async (data: unknown) => {
        return (data as { data: AIRunEvent }).data;
      });
    transition = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);
    jest.spyOn(AIRunService, "updateOneBy").mockResolvedValue(1);
    jest
      .spyOn(AIConfidenceSignal, "computeConfidenceSignal")
      .mockResolvedValue({
        confident: true,
        codeFixRecommended: false,
        source: "classification",
      });
    jest.spyOn(InvestigationTldr, "generateTldr").mockResolvedValue(null);
    jest.spyOn(LlmProviderChoice, "decideForRun").mockResolvedValue({
      provider: null,
      source: null,
      fallbackReason: null,
      pickedProviderId: "",
      activity: null,
    });
    answer = jest.spyOn(ObservabilityAssistant, "answerQuestion");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("in the transition that completes the run, with its counts", async () => {
    answer.mockResolvedValue(
      result({
        providerName: "Team Claude",
        modelName: "chat-large",
        providerType: LlmType.Anthropic,
      }),
    );

    await run();

    const set: AIRunTransitionSet = completion();

    expect(set).toMatchObject({
      status: AIRunStatus.Completed,
      llmCallCount: 2,
      toolCallCount: 3,
      totalTokens: 100,
      modelName: "chat-large",
      llmProviderType: LlmType.Anthropic,
    });
  });

  test("a loop whose calls named no model records none, and still completes", async () => {
    answer.mockResolvedValue(result());

    await run();

    const set: AIRunTransitionSet = completion();

    expect(set.status).toBe(AIRunStatus.Completed);
    expect(Object.keys(set)).not.toContain("modelName");
    expect(Object.keys(set)).not.toContain("llmProviderType");
  });

  test("a run that did not complete records no model", async () => {
    answer.mockRejectedValue(new Error("The provider is down."));

    await run();

    for (const args of transition.mock.calls) {
      expect(Object.keys(args[0].set)).not.toContain("modelName");
    }
  });
});
