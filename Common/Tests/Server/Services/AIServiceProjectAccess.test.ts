import AIService from "../../../Server/Services/AIService";
import LlmLogService from "../../../Server/Services/LlmLogService";
import LlmProviderService from "../../../Server/Services/LlmProviderService";
import ProjectService, {
  CurrentPlan,
} from "../../../Server/Services/ProjectService";
import LLMService from "../../../Server/Utils/LLM/LLMService";
import LlmLog from "../../../Models/DatabaseModels/LlmLog";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import Project from "../../../Models/DatabaseModels/Project";
import SubscriptionPlan, {
  PlanType,
} from "../../../Types/Billing/SubscriptionPlan";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import LlmType from "../../../Types/LLM/LlmType";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

type MockBillingGlobal = typeof globalThis & {
  __oneuptimeAiServiceTestBillingEnabled: boolean;
};

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const mockedEnvironmentConfig: Record<string, unknown> = { ...actual };
  const mockGlobal: MockBillingGlobal = globalThis as MockBillingGlobal;
  mockGlobal.__oneuptimeAiServiceTestBillingEnabled = true;

  Object.defineProperty(mockedEnvironmentConfig, "IsBillingEnabled", {
    configurable: true,
    enumerable: true,
    get: (): boolean => {
      return mockGlobal.__oneuptimeAiServiceTestBillingEnabled;
    },
  });

  return mockedEnvironmentConfig;
});

const projectId: ObjectID = ObjectID.generate();

function setMockIsBillingEnabled(value: boolean): void {
  (globalThis as MockBillingGlobal).__oneuptimeAiServiceTestBillingEnabled =
    value;
}

function fakeProject(enableAi: boolean = true): Project {
  return {
    id: projectId,
    enableAi,
  } as unknown as Project;
}

function mockProjectAndPlan(data: {
  project: Project | null;
  plan?: PlanType | null | undefined;
  isSubscriptionUnpaid?: boolean | undefined;
}): void {
  jest.spyOn(ProjectService, "findOneById").mockResolvedValue(data.project);
  jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
    plan: data.plan === undefined ? PlanType.Growth : data.plan,
    isSubscriptionUnpaid: data.isSubscriptionUnpaid ?? false,
  } as CurrentPlan);
}

describe("AIService.assertProjectCanUseAI", () => {
  beforeEach(() => {
    setMockIsBillingEnabled(true);
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    setMockIsBillingEnabled(true);
  });

  test("rejects when the project does not exist", async () => {
    mockProjectAndPlan({ project: null });

    await expect(
      AIService.assertProjectCanUseAI(projectId),
    ).rejects.toMatchObject({
      code: ExceptionCode.BadDataException,
      message: "Project not found.",
    });
  });

  test("rejects when AI is disabled for the project", async () => {
    mockProjectAndPlan({ project: fakeProject(false) });

    await expect(
      AIService.assertProjectCanUseAI(projectId),
    ).rejects.toMatchObject({
      code: ExceptionCode.BadDataException,
      message: expect.stringContaining("AI features are disabled"),
    });
  });

  test("rejects an unpaid cloud subscription before checking plan access", async () => {
    mockProjectAndPlan({
      project: fakeProject(),
      plan: PlanType.Growth,
      isSubscriptionUnpaid: true,
    });
    const planAccess: jest.SpiedFunction<
      typeof SubscriptionPlan.isFeatureAccessibleOnCurrentPlan
    > = jest.spyOn(SubscriptionPlan, "isFeatureAccessibleOnCurrentPlan");

    await expect(
      AIService.assertProjectCanUseAI(projectId),
    ).rejects.toMatchObject({
      code: ExceptionCode.PaymentRequiredException,
      message: expect.stringContaining("subscription is unpaid"),
    });
    expect(planAccess).not.toHaveBeenCalled();
  });

  test("rejects a cloud plan below Growth", async () => {
    mockProjectAndPlan({
      project: fakeProject(),
      plan: PlanType.Free,
    });
    const planAccess: jest.SpiedFunction<
      typeof SubscriptionPlan.isFeatureAccessibleOnCurrentPlan
    > = jest
      .spyOn(SubscriptionPlan, "isFeatureAccessibleOnCurrentPlan")
      .mockReturnValue(false);

    await expect(
      AIService.assertProjectCanUseAI(projectId),
    ).rejects.toMatchObject({
      code: ExceptionCode.PaymentRequiredException,
      message: expect.stringContaining("upgrade your plan to Growth"),
    });
    expect(planAccess).toHaveBeenCalledWith(
      PlanType.Growth,
      PlanType.Free,
      expect.any(Object),
    );
  });

  test("permits an enabled project on a paid eligible cloud plan", async () => {
    mockProjectAndPlan({
      project: fakeProject(),
      plan: PlanType.Enterprise,
    });
    const planAccess: jest.SpiedFunction<
      typeof SubscriptionPlan.isFeatureAccessibleOnCurrentPlan
    > = jest
      .spyOn(SubscriptionPlan, "isFeatureAccessibleOnCurrentPlan")
      .mockReturnValue(true);

    await expect(
      AIService.assertProjectCanUseAI(projectId),
    ).resolves.toBeUndefined();
    expect(planAccess).toHaveBeenCalledWith(
      PlanType.Growth,
      PlanType.Enterprise,
      expect.any(Object),
    );
  });

  test("permits an enabled self-hosted project without a subscription plan", async () => {
    setMockIsBillingEnabled(false);
    mockProjectAndPlan({
      project: fakeProject(),
      plan: null,
    });
    const planAccess: jest.SpiedFunction<
      typeof SubscriptionPlan.isFeatureAccessibleOnCurrentPlan
    > = jest.spyOn(SubscriptionPlan, "isFeatureAccessibleOnCurrentPlan");

    await expect(
      AIService.assertProjectCanUseAI(projectId),
    ).resolves.toBeUndefined();
    expect(planAccess).not.toHaveBeenCalled();
  });
});

function mockFailedProviderRequest(
  error: Error,
): jest.SpiedFunction<typeof LlmLogService.create> {
  jest.spyOn(LlmProviderService, "getProviderForChat").mockResolvedValue({
    id: ObjectID.generate(),
    name: "Test Provider",
    llmType: LlmType.OpenAI,
    modelName: "test-model",
    isGlobalLlm: false,
  } as unknown as LlmProvider);
  jest.spyOn(LLMService, "getCompletion").mockRejectedValue(error);

  return jest.spyOn(LlmLogService, "create").mockResolvedValue(new LlmLog());
}

describe("AIService.executeWithLogging error-detail storage", () => {
  beforeEach(() => {
    setMockIsBillingEnabled(true);
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    setMockIsBillingEnabled(true);
  });

  test("redacts provider details from both the thrown error and LLM log when disabled", async () => {
    const privateProviderDetail: string =
      "provider echoed private prompt value SECRET-123";
    const createLog: jest.SpiedFunction<typeof LlmLogService.create> =
      mockFailedProviderRequest(new Error(privateProviderDetail));
    const safeMessage: string =
      "The AI provider request failed. Review the provider configuration and try again.";

    await expect(
      AIService.executeWithLogging({
        projectId,
        feature: "AIService error-detail test",
        messages: [{ role: "user", content: "harmless test request" }],
        storeContentPreviews: false,
        storeErrorDetails: false,
      }),
    ).rejects.toMatchObject({
      code: ExceptionCode.BadDataException,
      message: safeMessage,
    });

    expect(createLog).toHaveBeenCalledTimes(1);
    expect(LLMService.getCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ includeProviderErrorDetails: false }),
    );
    const persistedLog: LlmLog = createLog.mock.calls[0]![0]!.data as LlmLog;
    expect(persistedLog.statusMessage).toBe(safeMessage);
    expect(JSON.stringify(persistedLog)).not.toContain(privateProviderDetail);
  });

  test("preserves raw provider error behavior by default", async () => {
    const providerError: Error = new Error("raw provider failure detail");
    const createLog: jest.SpiedFunction<typeof LlmLogService.create> =
      mockFailedProviderRequest(providerError);

    await expect(
      AIService.executeWithLogging({
        projectId,
        feature: "AIService default error-detail test",
        messages: [{ role: "user", content: "harmless test request" }],
        storeContentPreviews: false,
      }),
    ).rejects.toBe(providerError);

    expect(createLog).toHaveBeenCalledTimes(1);
    expect(LLMService.getCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ includeProviderErrorDetails: true }),
    );
    const persistedLog: LlmLog = createLog.mock.calls[0]![0]!.data as LlmLog;
    expect(persistedLog.statusMessage).toBe(providerError.message);
  });
});
