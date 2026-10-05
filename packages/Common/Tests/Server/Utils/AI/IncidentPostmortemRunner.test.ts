import AIIncidentPostmortemRunner from "../../../../Server/Utils/AI/SRE/IncidentPostmortemRunner";
import AIInvestigationEngine from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import AIService from "../../../../Server/Services/AIService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../../Server/Services/IncidentService";
import LlmProviderService from "../../../../Server/Services/LlmProviderService";
import ProjectService from "../../../../Server/Services/ProjectService";
import LlmLogService from "../../../../Server/Services/LlmLogService";
import logger from "../../../../Server/Utils/Logger";
import Incident from "../../../../Models/DatabaseModels/Incident";
import { IncidentFeedEventType } from "../../../../Models/DatabaseModels/IncidentFeed";
import LlmProvider from "../../../../Models/DatabaseModels/LlmProvider";
import Project from "../../../../Models/DatabaseModels/Project";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — the AI postmortem draft on resolve
 * (IncidentPostmortemRunner):
 *
 * - it has its OWN switch, Project.enableAutomaticPostmortemDraft, an
 *   opt-in (=== true). Automatic incident investigation is on by default for
 *   new projects; a draft writes to the incident and posts to Slack/Teams,
 *   so turning investigations on must never turn drafts on with it — and
 *   the investigation switch no longer has any say over drafts at all;
 * - the AI kill switch, the LLM provider and the AI balance still gate it
 *   exactly as they gate an investigation (the shared
 *   AIInvestigationEngine.getProviderOrBalanceReason);
 * - it never overwrites an existing postmortem and never throws into the
 *   resolve flow.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);

const BALANCE_BLOCKER: string =
  "This project is out of AI credits. Add credits under Project Settings → AI Credits, or turn on auto-recharge.";

function mockProject(
  project: Record<string, unknown> | null,
): jest.SpyInstance {
  return jest
    .spyOn(ProjectService, "findOneById")
    .mockResolvedValue(project as unknown as Project);
}

function draftOn(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: PROJECT_ID,
    enableAi: true,
    enableAutomaticPostmortemDraft: true,
    ...overrides,
  };
}

function mockProvider(provider: LlmProvider | null): jest.SpyInstance {
  return jest
    .spyOn(LlmProviderService, "getLLMProviderForProject")
    .mockResolvedValue(provider);
}

function mockBalanceBlocker(outcome: string | null): jest.SpyInstance {
  return jest
    .spyOn(AIService, "getAiBalanceBlocker")
    .mockResolvedValue(outcome);
}

describe("AIIncidentPostmortemRunner.isEnabledForProject", () => {
  beforeEach(() => {
    mockProvider(new LlmProvider());
    mockBalanceBlocker(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reads the project as root with the AI switch, the draft's own switch and the project's daily AI limits, once", async () => {
    const find: jest.SpyInstance = mockProject(draftOn());

    await AIIncidentPostmortemRunner.isEnabledForProject(PROJECT_ID);

    expect(find).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledWith({
      id: PROJECT_ID,
      select: {
        enableAi: true,
        enableAutomaticPostmortemDraft: true,
        aiDailyTokenLimit: true,
        aiDailySpendLimitInUSD: true,
      },
      props: { isRoot: true },
    });
  });

  it("is on when the draft switch is on, AI is on, a provider exists and there is balance", async () => {
    mockProject(draftOn());

    expect(
      await AIIncidentPostmortemRunner.isEnabledForProject(PROJECT_ID),
    ).toBe(true);
  });

  it("does not depend on automatic incident investigation — on without it", async () => {
    mockProject(draftOn({ enableAutomaticIncidentInvestigation: false }));
    const investigationGate: jest.SpyInstance = jest.spyOn(
      AIInvestigationEngine,
      "getDisabledReason",
    );

    expect(
      await AIIncidentPostmortemRunner.isEnabledForProject(PROJECT_ID),
    ).toBe(true);
    expect(investigationGate).not.toHaveBeenCalled();
  });

  it("is OFF with automatic incident investigation on but the draft switch off — investigations no longer imply drafts", async () => {
    mockProject(
      draftOn({
        enableAutomaticIncidentInvestigation: true,
        enableAutomaticPostmortemDraft: false,
      }),
    );

    expect(
      await AIIncidentPostmortemRunner.isEnabledForProject(PROJECT_ID),
    ).toBe(false);
  });

  it.each([
    ["false", false],
    ["never set (undefined)", undefined],
    ["null", null],
  ])(
    "is off when the draft switch is %s — only an explicit true opts in, and nothing else is read",
    async (_label: string, value: boolean | null | undefined) => {
      mockProject(draftOn({ enableAutomaticPostmortemDraft: value }));
      const provider: jest.SpyInstance = mockProvider(new LlmProvider());

      expect(
        await AIIncidentPostmortemRunner.isEnabledForProject(PROJECT_ID),
      ).toBe(false);
      expect(provider).not.toHaveBeenCalled();
    },
  );

  it("is off when Enable AI is off, without consulting the provider", async () => {
    mockProject(draftOn({ enableAi: false }));
    const provider: jest.SpyInstance = mockProvider(new LlmProvider());

    expect(
      await AIIncidentPostmortemRunner.isEnabledForProject(PROJECT_ID),
    ).toBe(false);
    expect(provider).not.toHaveBeenCalled();
  });

  it("treats an unset Enable AI as on, like every other AI gate", async () => {
    mockProject(draftOn({ enableAi: undefined }));

    expect(
      await AIIncidentPostmortemRunner.isEnabledForProject(PROJECT_ID),
    ).toBe(true);
  });

  it("is off when the project row is gone", async () => {
    mockProject(null);

    expect(
      await AIIncidentPostmortemRunner.isEnabledForProject(PROJECT_ID),
    ).toBe(false);
  });

  it("is off without an LLM provider", async () => {
    mockProject(draftOn());
    mockProvider(null);

    expect(
      await AIIncidentPostmortemRunner.isEnabledForProject(PROJECT_ID),
    ).toBe(false);
  });

  it("is off when the project is out of AI credits", async () => {
    mockProject(draftOn());
    const blocker: jest.SpyInstance = mockBalanceBlocker(BALANCE_BLOCKER);

    expect(
      await AIIncidentPostmortemRunner.isEnabledForProject(PROJECT_ID),
    ).toBe(false);
    expect(blocker).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT_ID }),
    );
  });

  /*
   * The project's own daily AI limits gate the draft the way they gate an
   * investigation: past one, the draft call would be refused - and logged
   * as an error - for every incident resolved until midnight UTC, so it is
   * skipped quietly instead.
   */
  it("is off once the project has reached its own daily AI limit", async () => {
    mockProject(draftOn({ aiDailyTokenLimit: 5000 }));
    jest.spyOn(LlmLogService, "getProjectUsageSince").mockResolvedValue({
      totalTokens: 5000,
      billedCostInUSDCents: 0,
    });

    expect(
      await AIIncidentPostmortemRunner.isEnabledForProject(PROJECT_ID),
    ).toBe(false);
  });

  it("is on while there is room under the project's daily AI limit", async () => {
    mockProject(draftOn({ aiDailyTokenLimit: 5000 }));
    jest.spyOn(LlmLogService, "getProjectUsageSince").mockResolvedValue({
      totalTokens: 4999,
      billedCostInUSDCents: 0,
    });

    expect(
      await AIIncidentPostmortemRunner.isEnabledForProject(PROJECT_ID),
    ).toBe(true);
  });

  it("with no daily AI limit set, counts nothing", async () => {
    mockProject(draftOn());
    const usage: jest.SpyInstance = jest.spyOn(
      LlmLogService,
      "getProjectUsageSince",
    );

    expect(
      await AIIncidentPostmortemRunner.isEnabledForProject(PROJECT_ID),
    ).toBe(true);
    expect(usage).not.toHaveBeenCalled();
  });
});

describe("AIIncidentPostmortemRunner.draftPostmortemOnResolve", () => {
  let incidentRead: jest.SpyInstance;
  let generate: jest.SpyInstance;
  let incidentUpdate: jest.SpyInstance;
  let feed: jest.SpyInstance;
  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    mockProject(draftOn());
    mockProvider(new LlmProvider());
    mockBalanceBlocker(null);
    incidentRead = jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue({
        id: INCIDENT_ID,
        incidentNumber: 42,
        postmortemNote: undefined,
      } as unknown as Incident);
    generate = jest
      .spyOn(IncidentService, "generatePostmortemFromAI")
      .mockResolvedValue("## Summary\nThe API ran out of connections.");
    incidentUpdate = jest
      .spyOn(IncidentService, "updateOneById")
      .mockResolvedValue(undefined as never);
    feed = jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never);
    jest.spyOn(logger, "debug").mockImplementation((): void => {
      return undefined;
    });
    errorLog = jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function resolve(): Promise<void> {
    await AIIncidentPostmortemRunner.draftPostmortemOnResolve({
      incidentId: INCIDENT_ID,
      projectId: PROJECT_ID,
    });
  }

  function expectNothingDone(): void {
    expect(incidentRead).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(incidentUpdate).not.toHaveBeenCalled();
    expect(feed).not.toHaveBeenCalled();
  }

  it("drafts, saves and announces the postmortem when its switch is on", async () => {
    await resolve();

    expect(generate).toHaveBeenCalledWith({ incidentId: INCIDENT_ID });
    expect(incidentUpdate).toHaveBeenCalledWith({
      id: INCIDENT_ID,
      data: { postmortemNote: "## Summary\nThe API ran out of connections." },
      props: { isRoot: true },
    });
    expect(feed).toHaveBeenCalledWith(
      expect.objectContaining({
        incidentId: INCIDENT_ID,
        projectId: PROJECT_ID,
        incidentFeedEventType: IncidentFeedEventType.PostmortemNote,
        feedInfoInMarkdown: expect.stringContaining("incident #42"),
        workspaceNotification: { sendWorkspaceNotification: true },
      }),
    );
  });

  it("drafts with automatic incident investigation OFF — the investigation switch has no say", async () => {
    mockProject(draftOn({ enableAutomaticIncidentInvestigation: false }));

    await resolve();

    expect(generate).toHaveBeenCalledTimes(1);
    expect(incidentUpdate).toHaveBeenCalledTimes(1);
  });

  it("does nothing with automatic incident investigation ON but the draft switch off", async () => {
    mockProject(
      draftOn({
        enableAutomaticIncidentInvestigation: true,
        enableAutomaticPostmortemDraft: false,
      }),
    );

    await resolve();

    expectNothingDone();
  });

  it("does nothing when AI is off", async () => {
    mockProject(draftOn({ enableAi: false }));

    await resolve();

    expectNothingDone();
  });

  it("does nothing without a provider", async () => {
    mockProvider(null);

    await resolve();

    expectNothingDone();
  });

  it("does nothing when the project is out of AI credits — no failed model call, no error log", async () => {
    mockBalanceBlocker(BALANCE_BLOCKER);

    await resolve();

    expectNothingDone();
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("never overwrites an existing postmortem", async () => {
    incidentRead.mockResolvedValue({
      id: INCIDENT_ID,
      incidentNumber: 42,
      postmortemNote: "Written by a human.",
    } as unknown as Incident);

    await resolve();

    expect(generate).not.toHaveBeenCalled();
    expect(incidentUpdate).not.toHaveBeenCalled();
    expect(feed).not.toHaveBeenCalled();
  });

  it("writes nothing when the model returns an empty draft", async () => {
    generate.mockResolvedValue("   ");

    await resolve();

    expect(incidentUpdate).not.toHaveBeenCalled();
    expect(feed).not.toHaveBeenCalled();
  });

  it("never throws into the resolve flow — a failing gate is logged", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockRejectedValue(new Error("database unavailable"));

    await expect(resolve()).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining("failed to draft postmortem"),
    );
    expect(generate).not.toHaveBeenCalled();
  });
});
