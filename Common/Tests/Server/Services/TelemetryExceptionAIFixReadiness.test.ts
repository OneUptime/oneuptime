import TelemetryExceptionService, {
  AIFixReadiness,
  AIFixReadinessCheck,
} from "../../../Server/Services/TelemetryExceptionService";
import LlmProviderService from "../../../Server/Services/LlmProviderService";
import ServiceService from "../../../Server/Services/ServiceService";
import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import AIAgentService from "../../../Server/Services/AIAgentService";
import { RepoResolution } from "../../../Server/Utils/CodeRepository/StackTraceRepoResolver";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import TelemetryService from "../../../Models/DatabaseModels/Service";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import AIAgent, {
  AIAgentConnectionStatus,
} from "../../../Models/DatabaseModels/AIAgent";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * "Fix with AI Agent" readiness: every prerequisite is checked BEFORE a task
 * is created. Since the runtime-resolution change there are exactly three
 * checks — LLM provider (project-owned, with a global fallback on
 * self-host), repository RESOLVED (stack-trace matching with fallbacks, no
 * Service Catalog prerequisite), agent online. These tests mock the
 * persistence layer and lock in each check's fail condition and the
 * fail-early behaviour of task creation.
 */

const projectId: ObjectID = ObjectID.generate();
const exceptionId: ObjectID = ObjectID.generate();
const serviceId: ObjectID = ObjectID.generate();

function fakeException(): TelemetryException {
  return {
    id: exceptionId,
    projectId: projectId,
    primaryEntityId: serviceId,
    stackTrace: "at charge (/app/src/billing/charge.ts:12:5)",
  } as unknown as TelemetryException;
}

function fakeResolution(): RepoResolution {
  return {
    codeRepositoryId: ObjectID.generate().toString(),
    organizationName: "acme",
    repositoryName: "checkout",
    servicePathInRepository: null,
    method: "stack-trace",
    evidence: "Matched src/billing/charge.ts in acme/checkout",
  };
}

function fakeAgent(data: {
  connectionStatus?: AIAgentConnectionStatus;
  lastAlive?: Date;
}): AIAgent {
  return {
    id: ObjectID.generate(),
    name: "agent",
    connectionStatus: data.connectionStatus,
    lastAlive: data.lastAlive,
  } as unknown as AIAgent;
}

interface ReadinessMocks {
  provider?: LlmProvider | null;
  resolution?: RepoResolution | null;
  resolutionThrows?: Error;
  agent?: AIAgent | null;
}

function mockReadiness(data: ReadinessMocks): void {
  jest
    .spyOn(TelemetryExceptionService, "findOneById")
    .mockResolvedValue(fakeException());
  jest
    .spyOn(LlmProviderService, "getLlmProviderForAgentTasks")
    .mockResolvedValue(
      data.provider === undefined
        ? ({ id: ObjectID.generate(), name: "BYO" } as unknown as LlmProvider)
        : data.provider,
    );
  jest.spyOn(ServiceService, "findOneById").mockResolvedValue({
    id: serviceId,
    name: "checkout",
  } as unknown as TelemetryService);

  const resolutionSpy: jest.SpiedFunction<
    typeof CodeRepositoryService.resolveRepositoryForException
  > = jest.spyOn(CodeRepositoryService, "resolveRepositoryForException");

  if (data.resolutionThrows) {
    resolutionSpy.mockRejectedValue(data.resolutionThrows);
  } else {
    resolutionSpy.mockResolvedValue(
      data.resolution === undefined ? fakeResolution() : data.resolution,
    );
  }

  jest
    .spyOn(AIAgentService, "getAIAgentForProject")
    .mockResolvedValue(
      data.agent === undefined
        ? fakeAgent({ connectionStatus: AIAgentConnectionStatus.Connected })
        : data.agent,
    );
}

function getCheck(readiness: AIFixReadiness, id: string): AIFixReadinessCheck {
  const check: AIFixReadinessCheck | undefined = readiness.checks.find(
    (item: AIFixReadinessCheck) => {
      return item.id === id;
    },
  );
  expect(check).toBeDefined();
  return check!;
}

describe("TelemetryExceptionService.getAIFixReadiness", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is ready with provider, resolved repository, and alive agent — exactly three checks", async () => {
    mockReadiness({});

    const readiness: AIFixReadiness =
      await TelemetryExceptionService.getAIFixReadiness({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true },
      });

    expect(readiness.ready).toBe(true);
    expect(readiness.checks).toHaveLength(3);
    for (const check of readiness.checks) {
      expect(check.ok).toBe(true);
    }
  });

  test("resolved repository is named in the check title as evidence", async () => {
    mockReadiness({});

    const readiness: AIFixReadiness =
      await TelemetryExceptionService.getAIFixReadiness({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true },
      });

    expect(getCheck(readiness, "repositoryResolved").title).toContain(
      "acme/checkout",
    );
  });

  test("fails llmProvider check when no provider is available", async () => {
    mockReadiness({ provider: null });

    const readiness: AIFixReadiness =
      await TelemetryExceptionService.getAIFixReadiness({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true },
      });

    expect(readiness.ready).toBe(false);
    const check: AIFixReadinessCheck = getCheck(readiness, "llmProvider");
    expect(check.ok).toBe(false);
    expect(check.detail).toContain("LLM Providers");
  });

  test("fails repositoryResolved check when nothing resolves", async () => {
    mockReadiness({ resolution: null });

    const readiness: AIFixReadiness =
      await TelemetryExceptionService.getAIFixReadiness({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true },
      });

    expect(readiness.ready).toBe(false);
    const check: AIFixReadinessCheck = getCheck(
      readiness,
      "repositoryResolved",
    );
    expect(check.ok).toBe(false);
    expect(check.detail).toContain("GitHub App");
  });

  test("resolver failure fails the check with the error surfaced, not a crash", async () => {
    mockReadiness({ resolutionThrows: new Error("GitHub API rate limited") });

    const readiness: AIFixReadiness =
      await TelemetryExceptionService.getAIFixReadiness({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true },
      });

    expect(readiness.ready).toBe(false);
    const check: AIFixReadinessCheck = getCheck(
      readiness,
      "repositoryResolved",
    );
    expect(check.ok).toBe(false);
    expect(check.detail).toContain("GitHub API rate limited");
  });

  test("fails agent check when the only agent has a stale heartbeat", async () => {
    mockReadiness({
      agent: fakeAgent({
        connectionStatus: AIAgentConnectionStatus.Disconnected,
        lastAlive: OneUptimeDate.getSomeMinutesAgo(10),
      }),
    });

    const readiness: AIFixReadiness =
      await TelemetryExceptionService.getAIFixReadiness({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true },
      });

    expect(readiness.ready).toBe(false);
    const check: AIFixReadinessCheck = getCheck(readiness, "agentAvailable");
    expect(check.ok).toBe(false);
    expect(check.detail).toContain("has not reported in");
  });
});

describe("TelemetryExceptionService.createAIAgentTaskForException fail-early", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("rejects with every missing prerequisite named, before any task is created", async () => {
    mockReadiness({ provider: null, agent: null });

    await expect(
      TelemetryExceptionService.createAIAgentTaskForException({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true },
      }),
    ).rejects.toThrow(BadDataException);

    await expect(
      TelemetryExceptionService.createAIAgentTaskForException({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true },
      }),
    ).rejects.toThrow(
      /LLM provider.*AI agent online|AI agent online.*LLM provider/,
    );
  });
});

describe("AIAgentService.isAgentAlive", () => {
  test("alive on Connected status regardless of lastAlive", () => {
    expect(
      AIAgentService.isAgentAlive(
        fakeAgent({ connectionStatus: AIAgentConnectionStatus.Connected }),
      ),
    ).toBe(true);
  });

  test("alive on a heartbeat within five minutes", () => {
    expect(
      AIAgentService.isAgentAlive(
        fakeAgent({ lastAlive: OneUptimeDate.getCurrentDate() }),
      ),
    ).toBe(true);
  });

  test("dead with a stale heartbeat and no Connected status", () => {
    expect(
      AIAgentService.isAgentAlive(
        fakeAgent({ lastAlive: OneUptimeDate.getSomeMinutesAgo(10) }),
      ),
    ).toBe(false);
  });

  test("dead with no heartbeat at all", () => {
    expect(AIAgentService.isAgentAlive(fakeAgent({}))).toBe(false);
  });
});
