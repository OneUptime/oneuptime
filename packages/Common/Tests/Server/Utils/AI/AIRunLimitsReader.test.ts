import ProjectService from "../../../../Server/Services/ProjectService";
import AIRunLimitsReader, {
  AI_LANE_INVESTIGATION_LIMITS_CARD_ANCHOR,
  ALERT_AI_SETTINGS_PATH,
  INCIDENT_AI_SETTINGS_PATH,
  PROJECT_AI_RUN_LIMITS_CARD_ANCHOR,
  PROJECT_AI_RUN_LIMITS_SETTINGS_PATH,
} from "../../../../Server/Utils/AI/AIRunLimitsReader";
import Project from "../../../../Models/DatabaseModels/Project";
import AIAgentRunLimitsHelper, {
  AIAgentRunLimits,
  AIRunStopReason,
  AIRunTimeLimitSource,
  CHAT_APP_ANSWER_TIME_LIMIT_IN_MINUTES,
  PROJECT_AI_RUN_LIMITS_LOCATION,
} from "../../../../Types/AI/AIAgentRunLimits";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * AIRunLimitsReader reads one AI run's limits from its project (issue
 * #6440): the caps the project set (none by default), and the most specific
 * time limit - an investigation lane's, then the project's, then the
 * default. These pin that a project with nothing set runs unbounded but for
 * the 120-minute default, that a project that cannot be read runs with the
 * defaults rather than not at all, that a chat answer keeps to Slack's
 * window, and that a stop note links to the very card of the setting.
 */

type MockGlobal = typeof globalThis & {
  __aiRunLimitsReaderDashboardUrl: string | null;
};

jest.mock("../../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const urlModule: { default: { fromString: (url: string) => unknown } } =
    jest.requireActual("../../../../Types/API/URL");
  const mocked: Record<string, unknown> = { ...actual };
  const mockGlobal: MockGlobal = globalThis as MockGlobal;
  mockGlobal.__aiRunLimitsReaderDashboardUrl =
    "https://oneuptime.example.com/dashboard";

  Object.defineProperty(mocked, "DashboardClientUrl", {
    configurable: true,
    enumerable: true,
    get: (): unknown => {
      return mockGlobal.__aiRunLimitsReaderDashboardUrl
        ? urlModule.default.fromString(
            mockGlobal.__aiRunLimitsReaderDashboardUrl,
          )
        : null;
    },
  });

  return mocked;
});

function setDashboardUrl(url: string | null): void {
  (globalThis as MockGlobal).__aiRunLimitsReaderDashboardUrl = url;
}

const MINUTE_MS: number = 60 * 1000;
const PROJECT_ID: ObjectID = new ObjectID(
  "8a1c2d3e-1111-4222-8333-944455556666",
);

function projectWith(values: Partial<Project>): Project {
  const project: Project = new Project();
  Object.assign(project, values);
  return project;
}

function mockProject(project: Project | null): Array<unknown> {
  const calls: Array<unknown> = [];

  jest
    .spyOn(ProjectService, "findOneById")
    .mockImplementation(async (query: unknown) => {
      calls.push(query);
      return project;
    });

  return calls;
}

afterEach(() => {
  jest.restoreAllMocks();
  setDashboardUrl("https://oneuptime.example.com/dashboard");
});

describe("AIRunLimitsReader.fromProject", () => {
  test("a project with nothing set: no caps, the default time limit", () => {
    expect(
      AIRunLimitsReader.fromProject({ project: new Project() }),
    ).toEqual(AIAgentRunLimitsHelper.getDefault());
    expect(AIRunLimitsReader.fromProject({ project: null })).toEqual(
      AIAgentRunLimitsHelper.getDefault(),
    );
  });

  test("the project's caps and time limit are the run's", () => {
    const limits: AIAgentRunLimits = AIRunLimitsReader.fromProject({
      project: projectWith({
        aiRunMaxModelCalls: 40,
        aiRunMaxToolCalls: 150,
        aiRunMaxTokens: 1_500_000,
        aiRunTimeLimitInMinutes: 20,
      }),
    });

    expect(limits).toEqual({
      maxLlmCalls: 40,
      maxToolCalls: 150,
      maxTokens: 1_500_000,
      maxWallClockMs: 20 * MINUTE_MS,
      timeLimitSource: AIRunTimeLimitSource.Project,
    });
  });

  test("an incident investigation uses the incident lane's time limit first", () => {
    const project: Project = projectWith({
      aiRunMaxToolCalls: 150,
      aiRunTimeLimitInMinutes: 20,
      incidentAiInvestigationTimeLimitInMinutes: 8,
      alertAiInvestigationTimeLimitInMinutes: 4,
    });

    expect(
      AIRunLimitsReader.fromProject({ project, lane: "Incident" }),
    ).toMatchObject({
      maxToolCalls: 150,
      maxWallClockMs: 8 * MINUTE_MS,
      timeLimitSource: AIRunTimeLimitSource.IncidentInvestigation,
    });
    expect(
      AIRunLimitsReader.fromProject({ project, lane: "Alert" }),
    ).toMatchObject({
      maxToolCalls: 150,
      maxWallClockMs: 4 * MINUTE_MS,
      timeLimitSource: AIRunTimeLimitSource.AlertInvestigation,
    });
    // Any other run never reads a lane's.
    expect(AIRunLimitsReader.fromProject({ project })).toMatchObject({
      maxWallClockMs: 20 * MINUTE_MS,
      timeLimitSource: AIRunTimeLimitSource.Project,
    });
  });

  test("a lane with no time limit of its own uses the project's, then the default", () => {
    expect(
      AIRunLimitsReader.fromProject({
        project: projectWith({ aiRunTimeLimitInMinutes: 20 }),
        lane: "Incident",
      }),
    ).toMatchObject({
      maxWallClockMs: 20 * MINUTE_MS,
      timeLimitSource: AIRunTimeLimitSource.Project,
    });
    expect(
      AIRunLimitsReader.fromProject({ project: new Project(), lane: "Alert" }),
    ).toMatchObject({
      maxWallClockMs: 120 * MINUTE_MS,
      timeLimitSource: AIRunTimeLimitSource.Default,
    });
  });
});

describe("AIRunLimitsReader.read", () => {
  test("reads the four limits and both lanes' time limits, as root", async () => {
    const calls: Array<unknown> = mockProject(new Project());

    await AIRunLimitsReader.read({ projectId: PROJECT_ID });

    expect(calls).toEqual([
      {
        id: PROJECT_ID,
        select: {
          aiRunMaxModelCalls: true,
          aiRunMaxToolCalls: true,
          aiRunMaxTokens: true,
          aiRunTimeLimitInMinutes: true,
          incidentAiInvestigationTimeLimitInMinutes: true,
          alertAiInvestigationTimeLimitInMinutes: true,
        },
        props: { isRoot: true },
      },
    ]);
  });

  test("a project with nothing set runs with no caps", async () => {
    mockProject(new Project());

    await expect(
      AIRunLimitsReader.read({ projectId: PROJECT_ID }),
    ).resolves.toEqual(AIAgentRunLimitsHelper.getDefault());
  });

  test("the lane is passed through", async () => {
    mockProject(projectWith({ incidentAiInvestigationTimeLimitInMinutes: 9 }));

    await expect(
      AIRunLimitsReader.read({ projectId: PROJECT_ID, lane: "Incident" }),
    ).resolves.toMatchObject({
      maxWallClockMs: 9 * MINUTE_MS,
      timeLimitSource: AIRunTimeLimitSource.IncidentInvestigation,
    });
  });

  test("a project that cannot be read runs with the defaults rather than not at all", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockRejectedValue(new Error("connection reset"));

    await expect(
      AIRunLimitsReader.read({ projectId: PROJECT_ID }),
    ).resolves.toEqual(AIAgentRunLimitsHelper.getDefault());
  });

  test("a chat answer keeps to the chat app's window, and to the project's caps", async () => {
    mockProject(projectWith({ aiRunMaxToolCalls: 150 }));

    const limits: AIAgentRunLimits = await AIRunLimitsReader.read({
      projectId: PROJECT_ID,
      isChatAppAnswer: true,
    });

    expect(limits).toEqual({
      maxLlmCalls: undefined,
      maxToolCalls: 150,
      maxTokens: undefined,
      maxWallClockMs: CHAT_APP_ANSWER_TIME_LIMIT_IN_MINUTES * MINUTE_MS,
      timeLimitSource: AIRunTimeLimitSource.ChatApp,
    });
  });

  test("a chat answer keeps a shorter time limit of the project's", async () => {
    mockProject(projectWith({ aiRunTimeLimitInMinutes: 5 }));

    await expect(
      AIRunLimitsReader.read({ projectId: PROJECT_ID, isChatAppAnswer: true }),
    ).resolves.toMatchObject({
      maxWallClockMs: 5 * MINUTE_MS,
      timeLimitSource: AIRunTimeLimitSource.Project,
    });
  });

  test("a chat answer of a project that cannot be read still keeps to the window", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockRejectedValue(new Error("connection reset"));

    await expect(
      AIRunLimitsReader.read({ projectId: PROJECT_ID, isChatAppAnswer: true }),
    ).resolves.toMatchObject({
      maxWallClockMs: CHAT_APP_ANSWER_TIME_LIMIT_IN_MINUTES * MINUTE_MS,
      timeLimitSource: AIRunTimeLimitSource.ChatApp,
    });
  });
});

describe("AIRunLimitsReader.getSettingsUrl", () => {
  const CAPPED: AIAgentRunLimits = {
    ...AIAgentRunLimitsHelper.getDefault(),
    maxToolCalls: 150,
  };

  test("a cap links to the project's Limits per run card", () => {
    for (const reason of [
      AIRunStopReason.ModelCalls,
      AIRunStopReason.ToolCalls,
      AIRunStopReason.Tokens,
    ]) {
      expect(
        AIRunLimitsReader.getSettingsUrl({
          projectId: PROJECT_ID,
          reason,
          limits: CAPPED,
        }),
      ).toBe(
        `https://oneuptime.example.com/dashboard/${PROJECT_ID.toString()}/settings/ai-features#LimitsPerRun`,
      );
    }
  });

  test("the project's or the default time limit links there too", () => {
    for (const source of [
      AIRunTimeLimitSource.Default,
      AIRunTimeLimitSource.Project,
    ]) {
      expect(
        AIRunLimitsReader.getSettingsUrl({
          projectId: PROJECT_ID,
          reason: AIRunStopReason.TimeLimit,
          limits: { ...CAPPED, timeLimitSource: source },
        }),
      ).toBe(
        `https://oneuptime.example.com/dashboard/${PROJECT_ID.toString()}/settings/ai-features#LimitsPerRun`,
      );
    }
  });

  test("a lane's time limit links to its lane's Investigation limits card", () => {
    expect(
      AIRunLimitsReader.getSettingsUrl({
        projectId: PROJECT_ID,
        reason: AIRunStopReason.TimeLimit,
        limits: {
          ...CAPPED,
          timeLimitSource: AIRunTimeLimitSource.IncidentInvestigation,
        },
      }),
    ).toBe(
      `https://oneuptime.example.com/dashboard/${PROJECT_ID.toString()}/incidents/ai/settings#InvestigationLimits`,
    );
    expect(
      AIRunLimitsReader.getSettingsUrl({
        projectId: PROJECT_ID,
        reason: AIRunStopReason.TimeLimit,
        limits: {
          ...CAPPED,
          timeLimitSource: AIRunTimeLimitSource.AlertInvestigation,
        },
      }),
    ).toBe(
      `https://oneuptime.example.com/dashboard/${PROJECT_ID.toString()}/alerts/ai/settings#InvestigationLimits`,
    );
  });

  test("a lane's source names no lane card for a cap: caps live on the project", () => {
    expect(
      AIRunLimitsReader.getSettingsUrl({
        projectId: PROJECT_ID,
        reason: AIRunStopReason.ToolCalls,
        limits: {
          ...CAPPED,
          timeLimitSource: AIRunTimeLimitSource.IncidentInvestigation,
        },
      }),
    ).toContain("/settings/ai-features#LimitsPerRun");
  });

  test("loop detection and a chat answer's window are no setting: no link", () => {
    expect(
      AIRunLimitsReader.getSettingsUrl({
        projectId: PROJECT_ID,
        reason: AIRunStopReason.Loop,
        limits: CAPPED,
      }),
    ).toBeNull();
    expect(
      AIRunLimitsReader.getSettingsUrl({
        projectId: PROJECT_ID,
        reason: AIRunStopReason.TimeLimit,
        limits: { ...CAPPED, timeLimitSource: AIRunTimeLimitSource.ChatApp },
      }),
    ).toBeNull();
  });

  test("a server that does not know the dashboard's address links nothing", () => {
    setDashboardUrl(null);

    expect(
      AIRunLimitsReader.getSettingsUrl({
        projectId: PROJECT_ID,
        reason: AIRunStopReason.ToolCalls,
        limits: CAPPED,
      }),
    ).toBeNull();
  });

  test("the paths and anchors are the dashboard's", () => {
    expect(PROJECT_AI_RUN_LIMITS_SETTINGS_PATH).toBe("settings/ai-features");
    expect(PROJECT_AI_RUN_LIMITS_CARD_ANCHOR).toBe("LimitsPerRun");
    expect(INCIDENT_AI_SETTINGS_PATH).toBe("incidents/ai/settings");
    expect(ALERT_AI_SETTINGS_PATH).toBe("alerts/ai/settings");
    expect(AI_LANE_INVESTIGATION_LIMITS_CARD_ANCHOR).toBe(
      "InvestigationLimits",
    );
  });
});

describe("AIRunLimitsReader.getStopNote", () => {
  test("names the limit and links to its card", () => {
    expect(
      AIRunLimitsReader.getStopNote({
        projectId: PROJECT_ID,
        reason: AIRunStopReason.ToolCalls,
        limits: {
          ...AIAgentRunLimitsHelper.getDefault(),
          maxToolCalls: 150,
        },
      }),
    ).toBe(
      `_This run stopped at this project's limit of 150 tool calls per run. Change it in [${PROJECT_AI_RUN_LIMITS_LOCATION}](https://oneuptime.example.com/dashboard/${PROJECT_ID.toString()}/settings/ai-features#LimitsPerRun)._`,
    );
  });

  test("without the dashboard's address, names the place in words", () => {
    setDashboardUrl(null);

    expect(
      AIRunLimitsReader.getStopNote({
        projectId: PROJECT_ID,
        reason: AIRunStopReason.TimeLimit,
        limits: AIAgentRunLimitsHelper.getDefault(),
      }),
    ).toBe(
      `_This run stopped at the time limit of 120 minutes per run, the default. Change it in ${PROJECT_AI_RUN_LIMITS_LOCATION}._`,
    );
  });
});
