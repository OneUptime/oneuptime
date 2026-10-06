import AIService, {
  AI_BALANCE_INSUFFICIENT_MESSAGE,
  AILogResponse,
} from "../../../Server/Services/AIService";
import AIBillingService from "../../../Server/Services/AIBillingService";
import { AI_BALANCE_INSUFFICIENT_NEXT_STEP } from "../../../Server/Services/KubernetesClusterAiAccessService";
import LlmLogService from "../../../Server/Services/LlmLogService";
import LlmProviderService from "../../../Server/Services/LlmProviderService";
import ProjectService from "../../../Server/Services/ProjectService";
import { CODE_FIX_AI_CREDITS_USED_UP_DETAIL } from "../../../Server/Utils/AI/CodeFix/CodeFixReadiness";
import LLMService from "../../../Server/Utils/LLM/LLMService";
import LlmLog from "../../../Models/DatabaseModels/LlmLog";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import Project from "../../../Models/DatabaseModels/Project";
import BadDataException from "../../../Types/Exception/BadDataException";
import LlmLogStatus from "../../../Types/LlmLogStatus";
import LlmType from "../../../Types/LLM/LlmType";
import ObjectID from "../../../Types/ObjectID";
import {
  getProjectBalanceWhoCanAddSentence,
  PROJECT_AI_CREDITS_USED_UP_MESSAGE,
  ProjectBalanceType,
} from "../../../Utils/Project/ProjectBalance";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHAT AN AI CALL IS REFUSED WITH ONCE THE PROJECT'S AI CREDITS ARE USED UP.
 *
 * Every AI call - Ask AI, a Slack or Microsoft Teams question, a workflow,
 * a runbook step, an investigation - passes AIService.executeWithLogging,
 * which refuses a call billed to the project's AI credits when there are
 * none left. It used to answer "Insufficient AI balance. Please recharge
 * your AI balance in Project Settings > AI Credits." to whoever asked, most
 * of whom may not add credits. It now says the credits are used up and who
 * can add them, and where (Utils/Project/ProjectBalance), and the AI Logs
 * row says the same.
 *
 * Also here, the other AI sentences about used-up credits, which every
 * reader of an AI readiness gap or the AI Tasks page sees: none tells the
 * reader to add credits, and none offers auto-recharge as the way out -
 * AI credits are recharged after a call they paid for, so a used-up
 * balance stays used up until someone adds credits.
 */

type MockBillingGlobal = typeof globalThis & {
  __aiCreditsUsedUpTestBillingEnabled: boolean;
};

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...actual };
  const mockGlobal: MockBillingGlobal = globalThis as MockBillingGlobal;
  mockGlobal.__aiCreditsUsedUpTestBillingEnabled = true;

  Object.defineProperty(mocked, "IsBillingEnabled", {
    configurable: true,
    enumerable: true,
    get: (): boolean => {
      return mockGlobal.__aiCreditsUsedUpTestBillingEnabled;
    },
  });

  return mocked;
});

function setBillingEnabled(value: boolean): void {
  (globalThis as MockBillingGlobal).__aiCreditsUsedUpTestBillingEnabled =
    value;
}

const PROJECT_ID: ObjectID = new ObjectID(
  "7e000000-0000-4000-8000-000000000001",
);

let projectLookup: jest.SpyInstance;
let providerForChat: jest.SpyInstance;
let completion: jest.SpyInstance;
let createLog: jest.SpyInstance;

function projectRow(values: Record<string, unknown> = {}): Project {
  return {
    id: PROJECT_ID,
    enableAi: true,
    aiCurrentBalanceInUSDCents: 0,
    ...values,
  } as unknown as Project;
}

// OneUptime's own provider on Cloud: billed to the project's AI credits.
function billedGlobalProvider(): LlmProvider {
  return {
    id: ObjectID.generate(),
    name: "OneUptime AI",
    llmType: LlmType.OpenAI,
    isGlobalLlm: true,
    costPerMillionTokensInUSDCents: 500,
  } as unknown as LlmProvider;
}

function ownProvider(): LlmProvider {
  return {
    id: ObjectID.generate(),
    name: "Our OpenAI",
    llmType: LlmType.OpenAI,
    isGlobalLlm: false,
    costPerMillionTokensInUSDCents: 0,
  } as unknown as LlmProvider;
}

async function ask(): Promise<AILogResponse> {
  return AIService.executeWithLogging({
    projectId: PROJECT_ID,
    feature: "Observability Chat",
    messages: [{ role: "user", content: "what broke?" }],
  });
}

async function refusalOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(BadDataException);
    return (error as Error).message;
  }

  throw new Error("Expected a refusal, but the call went through.");
}

// The LlmLog row the call wrote (the refusal, when it was refused).
function writtenLog(): LlmLog {
  return (createLog.mock.calls[0]![0] as { data: LlmLog }).data;
}

beforeEach(() => {
  setBillingEnabled(true);

  projectLookup = jest
    .spyOn(ProjectService, "findOneById")
    .mockResolvedValue(projectRow());
  providerForChat = jest
    .spyOn(LlmProviderService, "getProviderForChat")
    .mockResolvedValue(billedGlobalProvider());
  jest
    .spyOn(LlmProviderService, "getLLMProviderForProject")
    .mockResolvedValue(billedGlobalProvider());
  completion = jest.spyOn(LLMService, "getCompletion").mockResolvedValue({
    content: "the model answered",
    usage: { totalTokens: 1200 },
  } as Awaited<ReturnType<typeof LLMService.getCompletion>>);
  createLog = jest
    .spyOn(LlmLogService, "create")
    .mockResolvedValue(new LlmLog());
  jest
    .spyOn(LlmLogService, "getProjectUsageSince")
    .mockResolvedValue({ totalTokens: 0, billedCostInUSDCents: 0 });
  jest
    .spyOn(ProjectService, "deductAiBalanceInUSDCents")
    .mockResolvedValue(undefined);
  jest
    .spyOn(AIBillingService, "rechargeIfBalanceIsLow")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  setBillingEnabled(true);
});

describe("an AI call billed to used-up AI credits", () => {
  test("is refused with who can add credits, and where - not 'please recharge'", async () => {
    const message: string = await refusalOf(ask());

    expect(message).toBe(PROJECT_AI_CREDITS_USED_UP_MESSAGE);
    expect(message).toBe(
      "This project's AI credits are used up. A project owner or someone with Manage Billing can add AI credits in Project Settings → AI Credits.",
    );
    expect(message).not.toMatch(/please/i);
    expect(message).not.toMatch(/\brecharge\b/i);
    expect(message).not.toMatch(/\byour\b/i);
    expect(message.toLowerCase()).not.toContain("admin");
  });

  test("never reaches the model", async () => {
    await refusalOf(ask());

    expect(completion).not.toHaveBeenCalled();
  });

  test("is in the AI Logs as Insufficient Balance, saying the same", async () => {
    await refusalOf(ask());

    expect(createLog).toHaveBeenCalledTimes(1);
    expect(writtenLog().status).toBe(LlmLogStatus.InsufficientBalance);
    expect(writtenLog().statusMessage).toBe(PROJECT_AI_CREDITS_USED_UP_MESSAGE);
  });

  test("a balance below zero is refused the same way", async () => {
    projectLookup.mockResolvedValue(
      projectRow({ aiCurrentBalanceInUSDCents: -40 }),
    );

    expect(await refusalOf(ask())).toBe(PROJECT_AI_CREDITS_USED_UP_MESSAGE);
  });

  test("with credits left, the call goes through", async () => {
    projectLookup.mockResolvedValue(
      projectRow({ aiCurrentBalanceInUSDCents: 2500 }),
    );

    await expect(ask()).resolves.toBeDefined();
    expect(completion).toHaveBeenCalledTimes(1);
  });

  test("on the project's own provider, nothing is billed and nothing is refused", async () => {
    providerForChat.mockResolvedValue(ownProvider());

    await expect(ask()).resolves.toBeDefined();
    expect(completion).toHaveBeenCalledTimes(1);
  });

  test("where OneUptime does not bill AI, nothing is refused", async () => {
    setBillingEnabled(false);

    await expect(ask()).resolves.toBeDefined();
    expect(completion).toHaveBeenCalledTimes(1);
  });
});

describe("the other sentences about used-up AI credits", () => {
  test("the readiness gap's next step names who can add credits, and where", () => {
    expect(AI_BALANCE_INSUFFICIENT_NEXT_STEP).toBe(
      getProjectBalanceWhoCanAddSentence(ProjectBalanceType.AI),
    );
    expect(AI_BALANCE_INSUFFICIENT_NEXT_STEP).toBe(
      "A project owner or someone with Manage Billing can add AI credits in Project Settings → AI Credits.",
    );
  });

  test("the gap's description says what is wrong, not what to do", () => {
    expect(AI_BALANCE_INSUFFICIENT_MESSAGE).toBe(
      "This project's AI credit balance is used up and auto-recharge is off, so OneUptime AI cannot run.",
    );
  });

  test("the AI Tasks page's provider check names who can add credits, and that the project's own provider needs none", () => {
    expect(CODE_FIX_AI_CREDITS_USED_UP_DETAIL).toBe(
      "AI fix tasks would use the OneUptime-hosted LLM provider, which is paid from this project's AI credits, and they are used up. A project owner or someone with Manage Billing can add AI credits in Project Settings → AI Credits. A provider of the project's own (Project Settings > AI > LLM Providers) needs no AI credits.",
    );
  });

  test.each([
    [AI_BALANCE_INSUFFICIENT_NEXT_STEP],
    [CODE_FIX_AI_CREDITS_USED_UP_DETAIL],
    [PROJECT_AI_CREDITS_USED_UP_MESSAGE],
  ])(
    "never tells the reader to recharge, nor offers auto-recharge as the way out: %s",
    (sentence: string) => {
      expect(sentence).not.toMatch(/\brecharge\b/i);
      expect(sentence).not.toMatch(/auto-?recharge/i);
      expect(sentence).not.toMatch(/please/i);
      expect(sentence).toContain(
        "A project owner or someone with Manage Billing can add AI credits",
      );
    },
  );
});
