import AIService, {
  AI_AUTO_RECHARGE_FAILED_MESSAGE,
  AI_BALANCE_INSUFFICIENT_MESSAGE,
  AI_DISABLED_MESSAGE,
} from "../../../Server/Services/AIService";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import KubernetesClusterAiAccessService, {
  KubernetesClusterAiAccessProjectGates,
} from "../../../Server/Services/KubernetesClusterAiAccessService";
import LlmProviderService from "../../../Server/Services/LlmProviderService";
import ProjectService from "../../../Server/Services/ProjectService";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import Project from "../../../Models/DatabaseModels/Project";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — AIService.getAiBalanceBlocker, the ONE predicate
 * behind "out of AI credits": the cluster AI status's ai_balance_insufficient
 * gap and the investigation not-started reason both ask it, so the two never
 * disagree with each other or with the refusal executeWithLogging makes on
 * the call itself.
 *
 * A blocker exists only when ALL of these hold: billing is on, the
 * project's resolved LLM provider is the OneUptime-hosted (global) one with
 * a per-token cost, the balance is at or below zero, and Auto Recharge
 * cannot refill it before the next call - it is off, has nothing to add,
 * or its last charge failed (AIBillingService.getAutoRechargeState: the
 * next call would be refused too). With Auto Recharge on and set up, the
 * next billed call recharges the credits first and runs, so an empty
 * balance is no blocker. Everything else — a free global provider, the
 * project's own provider, no provider at all (its own gap), a positive
 * balance — is no blocker.
 */

type MockBillingGlobal = typeof globalThis & {
  __oneuptimeBalanceBlockerTestBillingEnabled: boolean;
};

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...actual };
  const mockGlobal: MockBillingGlobal = globalThis as MockBillingGlobal;
  mockGlobal.__oneuptimeBalanceBlockerTestBillingEnabled = true;

  Object.defineProperty(mocked, "IsBillingEnabled", {
    configurable: true,
    enumerable: true,
    get: (): boolean => {
      return mockGlobal.__oneuptimeBalanceBlockerTestBillingEnabled;
    },
  });

  return mocked;
});

function setBillingEnabled(value: boolean): void {
  (
    globalThis as MockBillingGlobal
  ).__oneuptimeBalanceBlockerTestBillingEnabled = value;
}

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

function provider(overrides: Record<string, unknown> = {}): LlmProvider {
  return {
    id: ObjectID.generate(),
    isGlobalLlm: true,
    costPerMillionTokensInUSDCents: 500,
    ...overrides,
  } as unknown as LlmProvider;
}

// A project row as stored: Auto Recharge's amounts default to 20 and 10 USD.
function project(overrides: Record<string, unknown> = {}): Project {
  return {
    aiCurrentBalanceInUSDCents: 0,
    enableAutoRechargeAiBalance: false,
    autoAiRechargeByBalanceInUSD: 20,
    autoRechargeAiWhenCurrentBalanceFallsInUSD: 10,
    lowAiBalanceNotificationSentToOwners: false,
    ...overrides,
  } as unknown as Project;
}

// What the shared cache says about Auto Recharge's last charge.
let lastChargeFailedAt: string | null = null;

describe("AIService.getAiBalanceBlocker", () => {
  let providerLookup: jest.SpyInstance;
  let projectLookup: jest.SpyInstance;
  let claimNotice: jest.SpyInstance;
  let ownerEmail: jest.SpyInstance;

  beforeEach(() => {
    setBillingEnabled(true);
    lastChargeFailedAt = null;
    providerLookup = jest
      .spyOn(LlmProviderService, "getLLMProviderForProject")
      .mockResolvedValue(provider());
    projectLookup = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(project());
    jest.spyOn(GlobalCache, "getString").mockImplementation((async () => {
      return lastChargeFailedAt;
    }) as never);
    // Somebody already told the owners, unless a test says otherwise.
    claimNotice = jest
      .spyOn(ProjectService, "claimAiCreditsUsedUpNotice")
      .mockResolvedValue(false);
    ownerEmail = jest
      .spyOn(ProjectService, "sendEmailToProjectOwners")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    setBillingEnabled(true);
  });

  it("blocks when billing is on, the provider is the paid global one, the balance is empty and auto-recharge is off", async () => {
    expect(await AIService.getAiBalanceBlocker({ projectId: PROJECT_ID })).toBe(
      AI_BALANCE_INSUFFICIENT_MESSAGE,
    );
  });

  it("blocks a negative balance too", async () => {
    projectLookup.mockResolvedValue(
      project({ aiCurrentBalanceInUSDCents: -250 }),
    );

    expect(await AIService.getAiBalanceBlocker({ projectId: PROJECT_ID })).toBe(
      AI_BALANCE_INSUFFICIENT_MESSAGE,
    );
  });

  it("blocks a balance that was never set (read as zero, like the call itself reads it)", async () => {
    projectLookup.mockResolvedValue(
      project({ aiCurrentBalanceInUSDCents: undefined }),
    );

    expect(await AIService.getAiBalanceBlocker({ projectId: PROJECT_ID })).toBe(
      AI_BALANCE_INSUFFICIENT_MESSAGE,
    );
  });

  it("reads the balance and Auto Recharge of THIS project, as root, in one read", async () => {
    await AIService.getAiBalanceBlocker({ projectId: PROJECT_ID });

    expect(projectLookup).toHaveBeenCalledTimes(1);
    expect(projectLookup).toHaveBeenCalledWith({
      id: PROJECT_ID,
      select: {
        aiCurrentBalanceInUSDCents: true,
        enableAutoRechargeAiBalance: true,
        autoAiRechargeByBalanceInUSD: true,
        autoRechargeAiWhenCurrentBalanceFallsInUSD: true,
        lowAiBalanceNotificationSentToOwners: true,
      },
      props: { isRoot: true },
    });
    expect(providerLookup).toHaveBeenCalledWith(PROJECT_ID);
  });

  it("no blocker when billing is off (self-hosted): nothing is metered", async () => {
    setBillingEnabled(false);

    expect(
      await AIService.getAiBalanceBlocker({ projectId: PROJECT_ID }),
    ).toBeNull();
    expect(providerLookup).not.toHaveBeenCalled();
    expect(projectLookup).not.toHaveBeenCalled();
  });

  it("no blocker when Auto Recharge is on: the next call recharges the credits first", async () => {
    projectLookup.mockResolvedValue(
      project({ enableAutoRechargeAiBalance: true }),
    );

    expect(
      await AIService.getAiBalanceBlocker({ projectId: PROJECT_ID }),
    ).toBeNull();
    expect(claimNotice).not.toHaveBeenCalled();
  });

  it("Auto Recharge on with no amount to add, or no balance to add it at: blocks, as off", async () => {
    for (const overrides of [
      { autoAiRechargeByBalanceInUSD: 0 },
      { autoAiRechargeByBalanceInUSD: null },
      { autoRechargeAiWhenCurrentBalanceFallsInUSD: 0 },
    ]) {
      projectLookup.mockResolvedValue(
        project({ enableAutoRechargeAiBalance: true, ...overrides }),
      );

      expect(
        await AIService.getAiBalanceBlocker({ projectId: PROJECT_ID }),
      ).toBe(AI_BALANCE_INSUFFICIENT_MESSAGE);
    }
  });

  it("Auto Recharge on but its last charge failed: blocks, saying so - the next call would be refused too", async () => {
    projectLookup.mockResolvedValue(
      project({ enableAutoRechargeAiBalance: true }),
    );
    lastChargeFailedAt = "2026-10-07T08:00:00.000Z";

    expect(await AIService.getAiBalanceBlocker({ projectId: PROJECT_ID })).toBe(
      AI_AUTO_RECHARGE_FAILED_MESSAGE,
    );
  });

  it("a failed charge does not block a project whose Auto Recharge is off: that is the plain message", async () => {
    lastChargeFailedAt = "2026-10-07T08:00:00.000Z";

    expect(await AIService.getAiBalanceBlocker({ projectId: PROJECT_ID })).toBe(
      AI_BALANCE_INSUFFICIENT_MESSAGE,
    );
  });

  it("a failure that cannot be read (the shared cache is down) reads as none: the call itself decides", async () => {
    projectLookup.mockResolvedValue(
      project({ enableAutoRechargeAiBalance: true }),
    );
    (GlobalCache.getString as unknown as jest.SpyInstance).mockRejectedValue(
      new Error("Cache is not connected"),
    );

    expect(
      await AIService.getAiBalanceBlocker({ projectId: PROJECT_ID }),
    ).toBeNull();
  });

  it("a blocker tells the project's owners the first time: one claim, one email", async () => {
    claimNotice.mockResolvedValue(true);

    await AIService.getAiBalanceBlocker({ projectId: PROJECT_ID });

    expect(claimNotice).toHaveBeenCalledTimes(1);
    expect(ownerEmail).toHaveBeenCalledTimes(1);
    expect(ownerEmail.mock.calls[0]![1]).toMatch(/^AI credits used up for /);
  });

  it("owners already told about this run-out cost no claim at all", async () => {
    projectLookup.mockResolvedValue(
      project({ lowAiBalanceNotificationSentToOwners: true }),
    );

    expect(await AIService.getAiBalanceBlocker({ projectId: PROJECT_ID })).toBe(
      AI_BALANCE_INSUFFICIENT_MESSAGE,
    );
    expect(claimNotice).not.toHaveBeenCalled();
    expect(ownerEmail).not.toHaveBeenCalled();
  });

  it("an email that cannot be sent still answers the blocker", async () => {
    claimNotice.mockRejectedValue(new Error("database unavailable"));

    expect(await AIService.getAiBalanceBlocker({ projectId: PROJECT_ID })).toBe(
      AI_BALANCE_INSUFFICIENT_MESSAGE,
    );
  });

  it("no blocker while the balance is positive", async () => {
    projectLookup.mockResolvedValue(project({ aiCurrentBalanceInUSDCents: 1 }));

    expect(
      await AIService.getAiBalanceBlocker({ projectId: PROJECT_ID }),
    ).toBeNull();
  });

  it("no blocker for the project's own provider: it bills the project's own account", async () => {
    providerLookup.mockResolvedValue(provider({ isGlobalLlm: false }));

    expect(
      await AIService.getAiBalanceBlocker({ projectId: PROJECT_ID }),
    ).toBeNull();
    expect(projectLookup).not.toHaveBeenCalled();
  });

  it("no blocker for a free global provider (no per-token cost)", async () => {
    for (const cost of [0, undefined, null]) {
      providerLookup.mockResolvedValue(
        provider({ costPerMillionTokensInUSDCents: cost }),
      );

      expect(
        await AIService.getAiBalanceBlocker({ projectId: PROJECT_ID }),
      ).toBeNull();
    }
  });

  it("no blocker when there is no provider at all: that is its own gap", async () => {
    providerLookup.mockResolvedValue(null);

    expect(
      await AIService.getAiBalanceBlocker({ projectId: PROJECT_ID }),
    ).toBeNull();
  });

  it("no blocker for a project row that cannot be found", async () => {
    projectLookup.mockResolvedValue(null);

    expect(
      await AIService.getAiBalanceBlocker({ projectId: PROJECT_ID }),
    ).toBeNull();
  });

  it("uses a provider the caller already resolved instead of looking it up again", async () => {
    expect(
      await AIService.getAiBalanceBlocker({
        projectId: PROJECT_ID,
        llmProvider: provider(),
      }),
    ).toBe(AI_BALANCE_INSUFFICIENT_MESSAGE);
    expect(
      await AIService.getAiBalanceBlocker({
        projectId: PROJECT_ID,
        llmProvider: null,
      }),
    ).toBeNull();
    expect(providerLookup).not.toHaveBeenCalled();
  });

  it("the reason is one plain sentence a person can act on", () => {
    expect(AI_BALANCE_INSUFFICIENT_MESSAGE).toBe(
      "This project's AI credit balance is used up and auto-recharge is off, so OneUptime AI cannot run.",
    );
    expect(AI_AUTO_RECHARGE_FAILED_MESSAGE).toBe(
      "This project's AI credit balance is used up and auto-recharge could not add more, so OneUptime AI cannot run.",
    );
  });
});

/*
 * The cluster AI status resolves the project's provider for its
 * llm_provider_missing gap and hands it to this predicate, so a status
 * build looks the provider up once. Billing is on here, so the predicate
 * really runs: a second lookup inside it would show as a second call.
 */
describe("KubernetesClusterAiAccessService.getProjectGates and the balance predicate", () => {
  let providerLookup: jest.SpyInstance;

  beforeEach(() => {
    setBillingEnabled(true);
    providerLookup = jest
      .spyOn(LlmProviderService, "getLLMProviderForProject")
      .mockResolvedValue(provider());
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(project());
    jest
      .spyOn(ProjectService, "claimAiCreditsUsedUpNotice")
      .mockResolvedValue(false);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    setBillingEnabled(true);
  });

  it("looks the provider up once and still reports the empty balance", async () => {
    const gates: KubernetesClusterAiAccessProjectGates =
      await KubernetesClusterAiAccessService.getProjectGates(PROJECT_ID);

    expect(providerLookup).toHaveBeenCalledTimes(1);
    expect(gates.hasLlmProvider).toBe(true);
    expect(gates.aiBalanceBlocker).toBe(AI_BALANCE_INSUFFICIENT_MESSAGE);
  });

  it("negative control: a funded balance is no blocker, still with one lookup", async () => {
    (
      ProjectService.findOneById as unknown as jest.SpyInstance
    ).mockResolvedValue(project({ aiCurrentBalanceInUSDCents: 5000 }));

    const gates: KubernetesClusterAiAccessProjectGates =
      await KubernetesClusterAiAccessService.getProjectGates(PROJECT_ID);

    expect(providerLookup).toHaveBeenCalledTimes(1);
    expect(gates.aiBalanceBlocker).toBeNull();
  });
});

describe("AI_DISABLED_MESSAGE", () => {
  /*
   * The Enable AI switch lives on the always-visible Project Settings → AI
   * Features page now; AI Credits is hidden on self-hosted installs.
   */
  it("points at Project Settings → AI Features, never AI Credits", () => {
    expect(AI_DISABLED_MESSAGE).toBe(
      "AI features are disabled for this project. Enable them in Project Settings → AI Features.",
    );
    expect(AI_DISABLED_MESSAGE).not.toContain("AI Credits");
  });
});
