import TelemetryExceptionService, {
  AIFixReadiness,
  AIFixReadinessCheck,
} from "../../../Server/Services/TelemetryExceptionService";
import LlmProviderService from "../../../Server/Services/LlmProviderService";
import ServiceService from "../../../Server/Services/ServiceService";
import ServiceCodeRepositoryService from "../../../Server/Services/ServiceCodeRepositoryService";
import AIAgentService from "../../../Server/Services/AIAgentService";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import TelemetryService from "../../../Models/DatabaseModels/Service";
import ServiceCodeRepository from "../../../Models/DatabaseModels/ServiceCodeRepository";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import AIAgent, {
  AIAgentConnectionStatus,
} from "../../../Models/DatabaseModels/AIAgent";
import CodeRepositoryType from "../../../Types/CodeRepository/CodeRepositoryType";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * "Fix with AI Agent" readiness (UX overhaul workstream A): every
 * prerequisite is checked BEFORE a task is created, so the dashboard can
 * render a checklist instead of a button whose failures surface minutes
 * later inside the agent container. These tests mock the persistence layer
 * and lock in each check's fail condition and the fail-early behaviour of
 * task creation.
 */

const projectId: ObjectID = ObjectID.generate();
const exceptionId: ObjectID = ObjectID.generate();
const serviceId: ObjectID = ObjectID.generate();

function fakeException(data?: {
  withService?: boolean;
  primaryEntityType?: string;
}): TelemetryException {
  return {
    id: exceptionId,
    projectId: projectId,
    primaryEntityId: data?.withService === false ? undefined : serviceId,
    primaryEntityType: data?.primaryEntityType,
  } as unknown as TelemetryException;
}

function fakeProvider(): LlmProvider {
  return { id: ObjectID.generate(), name: "BYO" } as unknown as LlmProvider;
}

function fakeService(): TelemetryService {
  return {
    id: serviceId,
    _id: serviceId.toString(),
    name: "checkout",
  } as unknown as TelemetryService;
}

function fakeRepoLink(data: {
  hostedAt: CodeRepositoryType;
  installationId?: string;
}): ServiceCodeRepository {
  return {
    codeRepository: {
      repositoryHostedAt: data.hostedAt,
      gitHubAppInstallationId: data.installationId,
      name: "repo",
    } as unknown as CodeRepository,
  } as unknown as ServiceCodeRepository;
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
  exception?: TelemetryException | null;
  provider?: LlmProvider | null;
  service?: TelemetryService | null;
  repoLinks?: Array<ServiceCodeRepository>;
  agent?: AIAgent | null;
}

function mockReadiness(data: ReadinessMocks): void {
  jest
    .spyOn(TelemetryExceptionService, "findOneById")
    .mockResolvedValue(
      data.exception === undefined ? fakeException() : data.exception,
    );
  jest
    .spyOn(LlmProviderService, "getProjectOwnedLlmProvider")
    .mockResolvedValue(
      data.provider === undefined ? fakeProvider() : data.provider,
    );
  jest
    .spyOn(ServiceService, "findOneById")
    .mockResolvedValue(
      data.service === undefined ? fakeService() : data.service,
    );
  jest.spyOn(ServiceCodeRepositoryService, "findBy").mockResolvedValue(
    data.repoLinks === undefined
      ? [
          fakeRepoLink({
            hostedAt: CodeRepositoryType.GitHub,
            installationId: "install-1",
          }),
        ]
      : data.repoLinks,
  );
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

  test("is ready when provider, service, GitHub-App repo, and alive agent all exist", async () => {
    mockReadiness({});

    const readiness: AIFixReadiness =
      await TelemetryExceptionService.getAIFixReadiness({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true },
      });

    expect(readiness.ready).toBe(true);
    expect(readiness.checks).toHaveLength(4);
    for (const check of readiness.checks) {
      expect(check.ok).toBe(true);
    }
  });

  test("fails llmProvider check when the project owns no provider", async () => {
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

  test("fails service and repository checks when the exception has no resolvable service", async () => {
    mockReadiness({
      exception: fakeException({ primaryEntityType: "Host" }),
      service: null,
    });

    const readiness: AIFixReadiness =
      await TelemetryExceptionService.getAIFixReadiness({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true },
      });

    expect(readiness.ready).toBe(false);
    expect(getCheck(readiness, "serviceLinked").ok).toBe(false);
    expect(getCheck(readiness, "serviceLinked").detail).toContain("Host");
    expect(getCheck(readiness, "repositoryLinked").ok).toBe(false);
  });

  test("fails repository check when links exist but none is GitHub-App connected", async () => {
    mockReadiness({
      repoLinks: [
        fakeRepoLink({ hostedAt: CodeRepositoryType.GitHub }), // no installation id
        fakeRepoLink({
          hostedAt: CodeRepositoryType.GitLab,
          installationId: "irrelevant",
        }),
      ],
    });

    const readiness: AIFixReadiness =
      await TelemetryExceptionService.getAIFixReadiness({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true },
      });

    expect(readiness.ready).toBe(false);
    const check: AIFixReadinessCheck = getCheck(readiness, "repositoryLinked");
    expect(check.ok).toBe(false);
    expect(check.detail).toContain("GitHub App");
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

  test("passes agent check on a fresh heartbeat even when status is stale-Disconnected", async () => {
    mockReadiness({
      agent: fakeAgent({
        connectionStatus: AIAgentConnectionStatus.Disconnected,
        lastAlive: OneUptimeDate.getCurrentDate(),
      }),
    });

    const readiness: AIFixReadiness =
      await TelemetryExceptionService.getAIFixReadiness({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true },
      });

    expect(getCheck(readiness, "agentAvailable").ok).toBe(true);
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
      /Project LLM provider.*AI agent online|AI agent online.*Project LLM provider/,
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
