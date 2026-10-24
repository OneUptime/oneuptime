import AIIncidentPostmortemRunner from "../../../../Server/Utils/AI/SRE/IncidentPostmortemRunner";
import LlmProviderChoice, {
  RuleLlmProviderChoice,
} from "../../../../Server/Utils/AI/LlmProviderChoice";
import {
  LlmProviderFallbackReason,
  LlmProviderSource,
} from "../../../../Types/AI/LlmProviderChoice";
import IncidentPostmortemCallWait from "../../../../Server/Utils/AI/SRE/IncidentPostmortemCallWait";
import { PostmortemRuleTemplate } from "../../../../Server/Utils/AI/SRE/PostmortemRules";
import PostmortemTemplatePick from "../../../../Server/Utils/AI/SRE/PostmortemTemplatePick";
import AIPostmortemRuleService from "../../../../Server/Services/AIPostmortemRuleService";
import IncidentPostmortemTemplateService from "../../../../Server/Services/IncidentPostmortemTemplateService";
import AIPostmortemRule from "../../../../Models/DatabaseModels/AIPostmortemRule";
import IncidentPostmortemTemplate from "../../../../Models/DatabaseModels/IncidentPostmortemTemplate";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import AIInvestigationEngine from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import IncidentVideoCallService from "../../../../Server/Services/IncidentVideoCallService";
import IncidentAIContextBuilder from "../../../../Server/Utils/AI/IncidentAIContextBuilder";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import PositiveNumber from "../../../../Types/PositiveNumber";
import AIService, {
  AI_BALANCE_INSUFFICIENT_MESSAGE,
} from "../../../../Server/Services/AIService";
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
 *   resolve flow;
 * - the postmortem rule that matches decides the LLM provider the draft is
 *   written with, as it decides the templates: its pick, else the project's
 *   default provider, else the global one - and the provider gates ask
 *   about that provider, so the incident and its rules are read before
 *   them (the two switches still come first).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);

const BALANCE_BLOCKER: string = AI_BALANCE_INSUFFICIENT_MESSAGE;

/*
 * The project's postmortem rules, as the rules service answers them: none,
 * unless a test says otherwise - so a draft is written for every resolved
 * incident, in the standard outline, as before rules existed.
 */
let storedRules: Array<AIPostmortemRule> = [];

beforeEach(() => {
  storedRules = [];
  jest
    .spyOn(AIPostmortemRuleService, "findBy")
    .mockImplementation(async (): Promise<Array<AIPostmortemRule>> => {
      return storedRules;
    });
  // No plan: billing is off, so the templates a rule names are followed.
  jest
    .spyOn(ProjectService, "getCurrentPlan")
    .mockResolvedValue({ plan: null, isSubscriptionUnpaid: false });
});

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
        aiDailyTokenLimitReachedAt: true,
        aiDailySpendLimitReachedAt: true,
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
  let callWait: jest.SpyInstance;
  let startWait: jest.SpyInstance;
  let callsRead: jest.SpyInstance;

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
    // No call of the incident has a transcript on its way, or in.
    callWait = jest
      .spyOn(IncidentPostmortemCallWait, "isWaiting")
      .mockResolvedValue(false);
    startWait = jest
      .spyOn(IncidentService, "startPostmortemDraftWait")
      .mockResolvedValue(undefined);
    callsRead = jest
      .spyOn(IncidentVideoCallService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
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
    expectNothingWritten();
  }

  /*
   * The provider gates ask about the provider the incident's postmortem
   * rule picks, so the incident is read before them: nothing is drafted,
   * saved or announced.
   */
  function expectNothingWritten(): void {
    expect(generate).not.toHaveBeenCalled();
    expect(incidentUpdate).not.toHaveBeenCalled();
    expect(feed).not.toHaveBeenCalled();
  }

  it("drafts, saves and announces the postmortem when its switch is on", async () => {
    await resolve();

    expect(generate).toHaveBeenCalledWith({
      incidentId: INCIDENT_ID,
      aiContext: null,
    });
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

    expectNothingWritten();
  });

  it("does nothing when the project is out of AI credits — no failed model call, no error log", async () => {
    mockBalanceBlocker(BALANCE_BLOCKER);

    await resolve();

    expectNothingWritten();
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

  /*
   * Saved into a postmortem switched on for the status page, the draft would
   * be what the status page shows the moment it is written: published
   * unreviewed, and announced to every subscriber.
   */
  it("never drafts into a postmortem switched on for the status page", async () => {
    incidentRead.mockResolvedValue({
      id: INCIDENT_ID,
      incidentNumber: 42,
      postmortemNote: undefined,
      showPostmortemOnStatusPage: true,
    } as unknown as Incident);

    await resolve();

    expect(generate).not.toHaveBeenCalled();
    expect(incidentUpdate).not.toHaveBeenCalled();
    expect(feed).not.toHaveBeenCalled();
  });

  it("reads whether the postmortem is switched on before drafting", async () => {
    await resolve();

    expect(
      (incidentRead.mock.calls[0]![0] as { select: Record<string, unknown> })
        .select,
    ).toEqual(
      expect.objectContaining({
        postmortemNote: true,
        showPostmortemOnStatusPage: true,
      }),
    );
    // Switched off, so the draft is saved for review.
    expect(incidentUpdate).toHaveBeenCalledTimes(1);
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

  describe("the incident's calls", () => {
    const RESOLVED_AT: Date = new Date("2026-10-19T12:00:00.000Z");

    async function resolveAt(now: Date): Promise<void> {
      await AIIncidentPostmortemRunner.draftPostmortemOnResolve({
        incidentId: INCIDENT_ID,
        projectId: PROJECT_ID,
        now,
      });
    }

    it("asks whether a call's transcript is on its way, from the resolve", async () => {
      await resolveAt(RESOLVED_AT);

      expect(callWait).toHaveBeenCalledWith({
        incidentId: INCIDENT_ID,
        waitingSince: RESOLVED_AT,
        now: RESOLVED_AT,
      });
    });

    it("waits for a transcript on its way: notes since when, and drafts nothing yet", async () => {
      callWait.mockResolvedValue(true);

      await resolveAt(RESOLVED_AT);

      expect(startWait).toHaveBeenCalledWith({
        incidentId: INCIDENT_ID,
        waitingSince: RESOLVED_AT,
      });
      expect(generate).not.toHaveBeenCalled();
      expect(incidentUpdate).not.toHaveBeenCalled();
      expect(feed).not.toHaveBeenCalled();
    });

    it("drafts at once, waiting for nothing, when no call's transcript is on its way", async () => {
      await resolveAt(RESOLVED_AT);

      expect(startWait).not.toHaveBeenCalled();
      expect(generate).toHaveBeenCalledTimes(1);
    });

    it("asks about the calls only for a draft it would write", async () => {
      incidentRead.mockResolvedValue({
        id: INCIDENT_ID,
        incidentNumber: 42,
        postmortemNote: "Written by a human.",
      } as unknown as Incident);

      await resolveAt(RESOLVED_AT);

      expect(callWait).not.toHaveBeenCalled();
      expect(startWait).not.toHaveBeenCalled();
    });

    it("says so in the feed when the draft read what was said on the incident's calls", async () => {
      callsRead.mockResolvedValue(new PositiveNumber(1));

      await resolveAt(RESOLVED_AT);

      expect(callsRead).toHaveBeenCalledWith(
        expect.objectContaining({ props: { isRoot: true } }),
      );
      expect(
        (feed.mock.calls[0]![0] as { feedInfoInMarkdown: string })
          .feedInfoInMarkdown,
      ).toContain(
        "from the incident timeline, telemetry and what was said on its calls.",
      );
    });

    it("says only timeline and telemetry when no call had a transcript", async () => {
      await resolveAt(RESOLVED_AT);

      expect(
        (feed.mock.calls[0]![0] as { feedInfoInMarkdown: string })
          .feedInfoInMarkdown,
      ).toContain("from the incident timeline and telemetry.");
    });

    it("a wait that cannot be noted is logged, never thrown into the resolve", async () => {
      callWait.mockResolvedValue(true);
      startWait.mockRejectedValue(new Error("database unavailable"));

      await expect(resolveAt(RESOLVED_AT)).resolves.toBeUndefined();
      expect(errorLog).toHaveBeenCalledWith(
        expect.stringContaining("failed to draft postmortem"),
      );
      expect(generate).not.toHaveBeenCalled();
    });
  });
});

describe("AIIncidentPostmortemRunner.draftWaitingPostmortem", () => {
  const WAITING_SINCE: Date = new Date("2026-10-19T12:00:00.000Z");
  const NOW: Date = new Date("2026-10-19T12:40:00.000Z");
  const STATE_ID: ObjectID = new ObjectID(
    "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  );

  let incidentRead: jest.SpyInstance;
  let isResolved: jest.SpyInstance;
  let callWait: jest.SpyInstance;
  let endWait: jest.SpyInstance;
  let generate: jest.SpyInstance;
  let incidentUpdate: jest.SpyInstance;
  let feed: jest.SpyInstance;

  function waitingIncident(overrides: Record<string, unknown> = {}): Incident {
    return {
      id: INCIDENT_ID,
      projectId: PROJECT_ID,
      incidentNumber: 42,
      postmortemNote: undefined,
      currentIncidentStateId: STATE_ID,
      postmortemDraftWaitingSince: WAITING_SINCE,
      ...overrides,
    } as unknown as Incident;
  }

  beforeEach(() => {
    mockProject(draftOn());
    mockProvider(new LlmProvider());
    mockBalanceBlocker(null);
    incidentRead = jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(waitingIncident());
    isResolved = jest
      .spyOn(IncidentPostmortemCallWait, "isResolved")
      .mockResolvedValue(true);
    callWait = jest
      .spyOn(IncidentPostmortemCallWait, "isWaiting")
      .mockResolvedValue(false);
    endWait = jest
      .spyOn(IncidentService, "endPostmortemDraftWait")
      .mockResolvedValue(1);
    generate = jest
      .spyOn(IncidentService, "generatePostmortemFromAI")
      .mockResolvedValue("## Summary\nThe deploy exhausted the pool.");
    incidentUpdate = jest
      .spyOn(IncidentService, "updateOneById")
      .mockResolvedValue(undefined as never);
    feed = jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(IncidentVideoCallService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));
    jest.spyOn(logger, "debug").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function due(): Promise<void> {
    await AIIncidentPostmortemRunner.draftWaitingPostmortem({
      incidentId: INCIDENT_ID,
      now: NOW,
    });
  }

  it("reads the incident as root, with its wait, its state, the draft's gates and what the rules match on", async () => {
    await due();

    expect(incidentRead).toHaveBeenCalledWith({
      id: INCIDENT_ID,
      select: {
        _id: true,
        incidentNumber: true,
        postmortemNote: true,
        showPostmortemOnStatusPage: true,
        title: true,
        description: true,
        incidentSeverityId: true,
        labels: { _id: true },
        monitors: { _id: true },
        projectId: true,
        currentIncidentStateId: true,
        postmortemDraftWaitingSince: true,
      },
      props: { isRoot: true },
    });
  });

  it("does nothing for an incident whose draft does not wait", async () => {
    incidentRead.mockResolvedValue(
      waitingIncident({ postmortemDraftWaitingSince: undefined }),
    );

    await due();

    expect(isResolved).not.toHaveBeenCalled();
    expect(endWait).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it("keeps waiting while a call's transcript is still expected", async () => {
    callWait.mockResolvedValue(true);

    await due();

    expect(callWait).toHaveBeenCalledWith({
      incidentId: INCIDENT_ID,
      waitingSince: WAITING_SINCE,
      now: NOW,
    });
    expect(endWait).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it("once nothing more is expected, ends the wait and writes the draft, saying it read the call", async () => {
    await due();

    expect(endWait).toHaveBeenCalledWith({
      incidentId: INCIDENT_ID,
      waitingSince: WAITING_SINCE,
    });
    expect(generate).toHaveBeenCalledWith({
      incidentId: INCIDENT_ID,
      aiContext: null,
    });
    expect(incidentUpdate).toHaveBeenCalledWith({
      id: INCIDENT_ID,
      data: { postmortemNote: "## Summary\nThe deploy exhausted the pool." },
      props: { isRoot: true },
    });
    expect(feed).toHaveBeenCalledWith(
      expect.objectContaining({
        incidentFeedEventType: IncidentFeedEventType.PostmortemNote,
        feedInfoInMarkdown: expect.stringContaining(
          "incident #42 from the incident timeline, telemetry and what was said on its calls.",
        ),
        workspaceNotification: { sendWorkspaceNotification: true },
      }),
    );
  });

  it("ends the wait before drafting, so a second caller at the same moment drafts nothing", async () => {
    endWait.mockResolvedValue(0);

    await due();

    expect(generate).not.toHaveBeenCalled();
    expect(feed).not.toHaveBeenCalled();
  });

  it("an incident reopened meanwhile stops waiting, undrafted: its next resolve decides again", async () => {
    isResolved.mockResolvedValue(false);
    callWait.mockResolvedValue(true);

    await due();

    expect(isResolved).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      currentIncidentStateId: STATE_ID,
    });
    // Whether its calls are still expected does not matter any more.
    expect(callWait).not.toHaveBeenCalled();
    expect(endWait).toHaveBeenCalledTimes(1);
    expect(generate).not.toHaveBeenCalled();
  });

  it("a postmortem a person wrote meanwhile is never replaced", async () => {
    incidentRead.mockResolvedValue(
      waitingIncident({ postmortemNote: "Written while we waited." }),
    );

    await due();

    expect(endWait).toHaveBeenCalledTimes(1);
    expect(generate).not.toHaveBeenCalled();
  });

  it("a postmortem switched on for the status page meanwhile is never drafted into", async () => {
    incidentRead.mockResolvedValue(
      waitingIncident({ showPostmortemOnStatusPage: true }),
    );

    await due();

    expect(endWait).toHaveBeenCalledTimes(1);
    expect(generate).not.toHaveBeenCalled();
  });

  it("a project that turned drafts (or AI) off meanwhile gets no draft", async () => {
    mockProject(draftOn({ enableAutomaticPostmortemDraft: false }));

    await due();

    expect(endWait).toHaveBeenCalledTimes(1);
    expect(generate).not.toHaveBeenCalled();
  });

  it("the rules as they are when the draft is written decide: one that stopped matching meanwhile means no draft", async () => {
    storedRules = [
      Object.assign(new AIPostmortemRule(), {
        _id: ObjectID.generate().toString(),
        name: "Only database incidents",
        titlePattern: "database",
      }),
    ];
    incidentRead.mockResolvedValue(
      waitingIncident({ title: "Checkout is slow" }),
    );

    await due();

    // The wait is over either way; the draft is not written.
    expect(endWait).toHaveBeenCalledTimes(1);
    expect(generate).not.toHaveBeenCalled();
    expect(feed).not.toHaveBeenCalled();
  });

  it("a draft that waited follows the template of the rule that matches it now", async () => {
    const templateId: string = "66666666-6666-4666-8666-666666666661";
    const template: IncidentPostmortemTemplate =
      new IncidentPostmortemTemplate();
    template._id = templateId;
    storedRules = [
      Object.assign(new AIPostmortemRule(), {
        _id: ObjectID.generate().toString(),
        name: "Database incidents",
        titlePattern: "database",
        postmortemTemplates: [template],
      }),
    ];
    jest.spyOn(IncidentPostmortemTemplateService, "findBy").mockResolvedValue([
      Object.assign(new IncidentPostmortemTemplate(), {
        _id: templateId,
        templateName: "Database outage",
        templateDescription: "",
        postmortemNote: "## Replication and failover",
      }),
    ]);
    incidentRead.mockResolvedValue(
      waitingIncident({ title: "Database primary is down" }),
    );

    await due();

    expect(generate).toHaveBeenCalledWith({
      incidentId: INCIDENT_ID,
      template: "## Replication and failover",
      aiContext: null,
    });
    expect(
      (feed.mock.calls[0]![0] as { feedInfoInMarkdown: string })
        .feedInfoInMarkdown,
    ).toContain(
      "what was said on its calls, following the postmortem template **Database outage**.",
    );
  });
});

describe("AIIncidentPostmortemRunner and the project's postmortem rules", () => {
  const CRITICAL_ID: string = "44444444-4444-4444-8444-444444444441";
  const MINOR_ID: string = "44444444-4444-4444-8444-444444444442";
  const DATABASE_OUTAGE_ID: string = "66666666-6666-4666-8666-666666666661";
  const SECURITY_INCIDENT_ID: string = "66666666-6666-4666-8666-666666666662";

  const DATABASE_OUTAGE: IncidentPostmortemTemplate = Object.assign(
    new IncidentPostmortemTemplate(),
    {
      _id: DATABASE_OUTAGE_ID,
      templateName: "Database outage",
      templateDescription: "Database failures.",
      postmortemNote: "## Summary\n\n## Replication and failover",
    },
  );
  const SECURITY_INCIDENT: IncidentPostmortemTemplate = Object.assign(
    new IncidentPostmortemTemplate(),
    {
      _id: SECURITY_INCIDENT_ID,
      templateName: "Security incident",
      templateDescription: "Access and data.",
      postmortemNote: "## Exposure",
    },
  );

  let incidentRead: jest.SpyInstance;
  let generate: jest.SpyInstance;
  let incidentUpdate: jest.SpyInstance;
  let feed: jest.SpyInstance;
  let callWait: jest.SpyInstance;
  let startWait: jest.SpyInstance;
  let templatesRead: jest.SpyInstance;
  let errorLog: jest.SpyInstance;
  let debugLog: jest.SpyInstance;

  function severity(id: string): IncidentSeverity {
    const model: IncidentSeverity = new IncidentSeverity();
    model._id = id;
    return model;
  }

  function templateRef(id: string): IncidentPostmortemTemplate {
    const model: IncidentPostmortemTemplate = new IncidentPostmortemTemplate();
    model._id = id;
    return model;
  }

  function rule(
    name: string,
    values: Partial<AIPostmortemRule> = {},
  ): AIPostmortemRule {
    return Object.assign(new AIPostmortemRule(), {
      _id: ObjectID.generate().toString(),
      name,
      isEnabled: true,
      ...values,
    });
  }

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
        title: "Postgres primary is down",
        description: "Connections refused.",
        incidentSeverityId: new ObjectID(CRITICAL_ID),
        labels: [],
        monitors: [],
      } as unknown as Incident);
    generate = jest
      .spyOn(IncidentService, "generatePostmortemFromAI")
      .mockResolvedValue("## Summary\nThe primary ran out of disk.");
    incidentUpdate = jest
      .spyOn(IncidentService, "updateOneById")
      .mockResolvedValue(undefined as never);
    feed = jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never);
    callWait = jest
      .spyOn(IncidentPostmortemCallWait, "isWaiting")
      .mockResolvedValue(false);
    startWait = jest
      .spyOn(IncidentService, "startPostmortemDraftWait")
      .mockResolvedValue(undefined);
    jest
      .spyOn(IncidentVideoCallService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    templatesRead = jest
      .spyOn(IncidentPostmortemTemplateService, "findBy")
      .mockResolvedValue([DATABASE_OUTAGE, SECURITY_INCIDENT]);
    errorLog = jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    debugLog = jest.spyOn(logger, "debug").mockImplementation((): void => {
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

  function feedLine(): string {
    return (feed.mock.calls[0]![0] as { feedInfoInMarkdown: string })
      .feedInfoInMarkdown;
  }

  it("with no rule, drafts every resolved incident in the standard outline - no template sent", async () => {
    await resolve();

    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0]![0]).toEqual({
      incidentId: INCIDENT_ID,
      aiContext: null,
    });
    expect(feedLine()).not.toContain("template");
    expect(templatesRead).not.toHaveBeenCalled();
  });

  it("reads what the rules match on with the incident it drafts for", async () => {
    await resolve();

    expect(
      (incidentRead.mock.calls[0]![0] as { select: Record<string, unknown> })
        .select,
    ).toEqual(
      expect.objectContaining({
        title: true,
        description: true,
        incidentSeverityId: true,
        labels: { _id: true },
        monitors: { _id: true },
      }),
    );
  });

  it("an incident no rule matches gets no draft, waits for no call, and says why in the debug log", async () => {
    storedRules = [
      rule("Minor incidents", { incidentSeverities: [severity(MINOR_ID)] }),
    ];

    await resolve();

    expect(generate).not.toHaveBeenCalled();
    expect(incidentUpdate).not.toHaveBeenCalled();
    expect(feed).not.toHaveBeenCalled();
    expect(callWait).not.toHaveBeenCalled();
    expect(startWait).not.toHaveBeenCalled();
    expect(debugLog).toHaveBeenCalledWith(
      expect.stringContaining(
        "none of the 1 postmortem rules matched incident",
      ),
    );
  });

  it("a matching rule with no template drafts in the standard outline", async () => {
    storedRules = [
      rule("Critical incidents", {
        incidentSeverities: [severity(CRITICAL_ID)],
      }),
    ];

    await resolve();

    expect(generate.mock.calls[0]![0]).toEqual({
      incidentId: INCIDENT_ID,
      aiContext: null,
    });
  });

  it("a matching rule's one template is filled in, and the feed names it", async () => {
    storedRules = [
      rule("Critical incidents", {
        incidentSeverities: [severity(CRITICAL_ID)],
        postmortemTemplates: [templateRef(DATABASE_OUTAGE_ID)],
      }),
    ];
    templatesRead.mockResolvedValue([DATABASE_OUTAGE]);
    const pick: jest.SpyInstance = jest.spyOn(PostmortemTemplatePick, "pick");

    await resolve();

    expect(generate).toHaveBeenCalledWith({
      incidentId: INCIDENT_ID,
      template: "## Summary\n\n## Replication and failover",
      aiContext: null,
    });
    expect(pick).toHaveBeenCalledTimes(1);
    expect(feedLine()).toContain(
      "OneUptime AI drafted a postmortem for incident #42 from the incident timeline and telemetry, following the postmortem template **Database outage**. It has been saved on the incident for you to review and edit.",
    );
    expect(incidentUpdate).toHaveBeenCalledWith({
      id: INCIDENT_ID,
      data: { postmortemNote: "## Summary\nThe primary ran out of disk." },
      props: { isRoot: true },
    });
  });

  it("with several templates, the one OneUptime AI picks is filled in", async () => {
    storedRules = [
      rule("Critical incidents", {
        incidentSeverities: [severity(CRITICAL_ID)],
        postmortemTemplates: [
          templateRef(DATABASE_OUTAGE_ID),
          templateRef(SECURITY_INCIDENT_ID),
        ],
      }),
    ];
    const pick: jest.SpyInstance = jest
      .spyOn(PostmortemTemplatePick, "pick")
      .mockImplementation(
        async (data: {
          templates: Array<PostmortemRuleTemplate>;
        }): Promise<PostmortemRuleTemplate | null> => {
          return data.templates[1] || null;
        },
      );

    await resolve();

    expect(
      (
        pick.mock.calls[0]![0] as { templates: Array<PostmortemRuleTemplate> }
      ).templates.map((template: PostmortemRuleTemplate): string => {
        return template.name;
      }),
    ).toEqual(["Database outage", "Security incident"]);
    expect(generate).toHaveBeenCalledWith({
      incidentId: INCIDENT_ID,
      template: "## Exposure",
      aiContext: null,
    });
    expect(feedLine()).toContain(
      "following the postmortem template **Security incident**.",
    );
  });

  it("the first matching rule decides, not a later one", async () => {
    storedRules = [
      rule("Critical incidents", {
        incidentSeverities: [severity(CRITICAL_ID)],
        postmortemTemplates: [templateRef(SECURITY_INCIDENT_ID)],
      }),
      rule("Everything else", {
        postmortemTemplates: [templateRef(DATABASE_OUTAGE_ID)],
      }),
    ];
    templatesRead.mockResolvedValue([SECURITY_INCIDENT]);

    await resolve();

    expect(generate).toHaveBeenCalledWith({
      incidentId: INCIDENT_ID,
      template: "## Exposure",
      aiContext: null,
    });
  });

  it("a template's name reaches the feed as text: no link, no bold of its own", async () => {
    storedRules = [
      rule("All", { postmortemTemplates: [templateRef(DATABASE_OUTAGE_ID)] }),
    ];
    templatesRead.mockResolvedValue([
      Object.assign(new IncidentPostmortemTemplate(), {
        _id: DATABASE_OUTAGE_ID,
        templateName: "**Pwn** [click](https://evil.example)",
        templateDescription: "",
        postmortemNote: "## Summary",
      }),
    ]);

    await resolve();

    expect(feedLine()).not.toContain("[click](https://evil.example)");
    expect(feedLine()).not.toContain("**Pwn**");
    expect(feedLine()).toContain("Pwn");
  });

  it("no draft when the rules cannot be read: the project's rules are kept to, and the error logged", async () => {
    jest
      .spyOn(AIPostmortemRuleService, "findBy")
      .mockRejectedValue(new Error("connection reset"));

    await resolve();

    expect(generate).not.toHaveBeenCalled();
    expect(feed).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining("could not read the postmortem rules"),
      expect.anything(),
    );
  });

  it("the rules decide before any wait: an incident a rule matches still waits for its call", async () => {
    storedRules = [
      rule("Critical incidents", {
        incidentSeverities: [severity(CRITICAL_ID)],
      }),
    ];
    callWait.mockResolvedValue(true);

    await resolve();

    expect(startWait).toHaveBeenCalledTimes(1);
    expect(generate).not.toHaveBeenCalled();
  });

  it("the switch stays the one way to turn drafting off: with it off, no rule is even read", async () => {
    mockProject(draftOn({ enableAutomaticPostmortemDraft: false }));
    const rulesRead: jest.SpyInstance = jest.spyOn(
      AIPostmortemRuleService,
      "findBy",
    );
    storedRules = [rule("Everything")];

    await resolve();

    expect(rulesRead).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it("a written postmortem is never replaced, whatever the rules say", async () => {
    storedRules = [rule("Everything")];
    incidentRead.mockResolvedValue({
      id: INCIDENT_ID,
      incidentNumber: 42,
      postmortemNote: "Written by a human.",
    } as unknown as Incident);
    const rulesRead: jest.SpyInstance = jest.spyOn(
      AIPostmortemRuleService,
      "findBy",
    );

    await resolve();

    expect(rulesRead).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });
});

/*
 * The postmortem rule that matches decides the LLM provider the draft is
 * written with, as it decides the templates (PostmortemRules,
 * Server/Utils/AI/LlmProviderChoice): its pick, else the project's default
 * provider, else the global one. The template pick and the draft both use
 * it; the provider gates ask about it, so a rule's own provider drafts in a
 * project whose default cannot; the feed item names it, or says why another
 * was used.
 */
describe("AIIncidentPostmortemRunner and the LLM provider a postmortem rule picks", () => {
  const OPUS: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
  const AZURE: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
  const CRITICAL_ID: string = "44444444-4444-4444-8444-444444444441";
  const OUTAGE_ID: string = "66666666-6666-4666-8666-666666666661";
  const SECURITY_ID: string = "66666666-6666-4666-8666-666666666662";

  const OPUS_ROW: LlmProvider = Object.assign(new LlmProvider(), {
    _id: OPUS,
    name: "Claude Opus",
    isGlobalLlm: false,
  });

  let incidentRead: jest.SpyInstance;
  let generate: jest.SpyInstance;
  let feed: jest.SpyInstance;
  let decide: jest.SpyInstance;
  let decideIfPicked: jest.SpyInstance;
  let projectProvider: jest.SpyInstance;

  function rule(
    name: string,
    values: Partial<AIPostmortemRule> = {},
  ): AIPostmortemRule {
    return Object.assign(new AIPostmortemRule(), {
      _id: ObjectID.generate().toString(),
      name,
      isEnabled: true,
      ...values,
    });
  }

  function criticalRule(
    values: Partial<AIPostmortemRule> = {},
  ): AIPostmortemRule {
    const critical: IncidentSeverity = new IncidentSeverity();
    critical._id = CRITICAL_ID;

    return rule("Critical incidents", {
      incidentSeverities: [critical],
      llmProviderId: new ObjectID(OPUS),
      ...values,
    });
  }

  function templateRef(id: string): IncidentPostmortemTemplate {
    const model: IncidentPostmortemTemplate = new IncidentPostmortemTemplate();
    model._id = id;
    return model;
  }

  // The rule's pick, used as it is.
  function picked(): RuleLlmProviderChoice {
    return {
      provider: { id: OPUS, name: "Claude Opus", isGlobal: false },
      source: LlmProviderSource.RulePick,
      fallbackReason: null,
      pickedProviderId: OPUS,
      llmProviderId: new ObjectID(OPUS),
      providerRow: OPUS_ROW,
      activity: {
        source: LlmProviderSource.RulePick,
        providerName: "Claude Opus",
      },
    };
  }

  // The rule's pick could not be used: the project's default instead.
  function fellBack(
    reason: LlmProviderFallbackReason,
    source: LlmProviderSource = LlmProviderSource.ProjectDefault,
  ): RuleLlmProviderChoice {
    return {
      provider: {
        id: AZURE,
        name: "Azure GPT-4o",
        isGlobal: source === LlmProviderSource.Global,
      },
      source,
      fallbackReason: reason,
      pickedProviderId: OPUS,
      providerRow: Object.assign(new LlmProvider(), {
        _id: AZURE,
        name: "Azure GPT-4o",
      }),
      activity: {
        source,
        providerName: "Azure GPT-4o",
        fallbackReason: reason,
      },
    };
  }

  function nothingLeft(): RuleLlmProviderChoice {
    return {
      provider: null,
      source: null,
      fallbackReason: LlmProviderFallbackReason.Unavailable,
      pickedProviderId: OPUS,
      providerRow: null,
      activity: { fallbackReason: LlmProviderFallbackReason.Unavailable },
    };
  }

  function choose(choice: RuleLlmProviderChoice): void {
    decide.mockResolvedValue(choice);
    decideIfPicked.mockResolvedValue(choice);
  }

  beforeEach(() => {
    mockProject(draftOn());
    projectProvider = mockProvider(
      Object.assign(new LlmProvider(), { _id: AZURE, name: "Azure GPT-4o" }),
    );
    mockBalanceBlocker(null);
    storedRules = [criticalRule()];
    incidentRead = jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue({
        id: INCIDENT_ID,
        incidentNumber: 42,
        postmortemNote: undefined,
        title: "Postgres primary is down",
        incidentSeverityId: new ObjectID(CRITICAL_ID),
        labels: [],
        monitors: [],
      } as unknown as Incident);
    generate = jest
      .spyOn(IncidentService, "generatePostmortemFromAI")
      .mockResolvedValue("## Summary\nThe primary ran out of disk.");
    jest
      .spyOn(IncidentService, "updateOneById")
      .mockResolvedValue(undefined as never);
    feed = jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(IncidentPostmortemCallWait, "isWaiting")
      .mockResolvedValue(false);
    jest
      .spyOn(IncidentVideoCallService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest.spyOn(IncidentPostmortemTemplateService, "findBy").mockResolvedValue([
      Object.assign(new IncidentPostmortemTemplate(), {
        _id: OUTAGE_ID,
        templateName: "Database outage",
        templateDescription: "",
        postmortemNote: "## Replication and failover",
      }),
      Object.assign(new IncidentPostmortemTemplate(), {
        _id: SECURITY_ID,
        templateName: "Security incident",
        templateDescription: "",
        postmortemNote: "## Exposure",
      }),
    ]);
    jest.spyOn(logger, "debug").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    decide = jest.spyOn(LlmProviderChoice, "decide");
    decideIfPicked = jest.spyOn(LlmProviderChoice, "decideIfPicked");
    choose(picked());
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

  function feedLine(): string {
    return (feed.mock.calls[0]![0] as { feedInfoInMarkdown: string })
      .feedInfoInMarkdown;
  }

  it("the draft is written with the matching rule's provider, and the feed names it and the rule", async () => {
    await resolve();

    expect(decideIfPicked).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      pickedProviderId: new ObjectID(OPUS),
    });
    expect(generate).toHaveBeenCalledWith({
      incidentId: INCIDENT_ID,
      llmProviderId: new ObjectID(OPUS),
      aiContext: null,
    });
    expect(feedLine()).toContain(
      "OneUptime AI drafted a postmortem for incident #42 from the incident timeline and telemetry. It was written with **Claude Opus**, the LLM provider of postmortem rule **Critical incidents**. It has been saved on the incident for you to review and edit.",
    );
  });

  it("OneUptime AI picks the template with it too", async () => {
    storedRules = [
      criticalRule({
        postmortemTemplates: [templateRef(OUTAGE_ID), templateRef(SECURITY_ID)],
      }),
    ];
    const pick: jest.SpyInstance = jest
      .spyOn(PostmortemTemplatePick, "pick")
      .mockImplementation(
        async (data: {
          templates: Array<PostmortemRuleTemplate>;
        }): Promise<PostmortemRuleTemplate | null> => {
          return data.templates[1] || null;
        },
      );

    await resolve();

    expect(
      (pick.mock.calls[0]![0] as { llmProviderId?: ObjectID }).llmProviderId,
    ).toEqual(new ObjectID(OPUS));
    expect(generate).toHaveBeenCalledWith({
      incidentId: INCIDENT_ID,
      template: "## Exposure",
      llmProviderId: new ObjectID(OPUS),
      aiContext: null,
    });
  });

  it("the first matching rule decides the provider, as it decides the templates", async () => {
    storedRules = [
      criticalRule(),
      rule("Everything else", { llmProviderId: new ObjectID(AZURE) }),
    ];

    await resolve();

    expect(decideIfPicked).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      pickedProviderId: new ObjectID(OPUS),
    });
    expect(
      decideIfPicked.mock.calls.every((call: Array<unknown>): boolean => {
        return (
          String(
            (call[0] as { pickedProviderId?: ObjectID }).pickedProviderId,
          ) === OPUS
        );
      }),
    ).toBe(true);
  });

  it("a rule that picks none: the project's provider, and the feed says nothing of providers", async () => {
    decideIfPicked.mockRestore();
    decide.mockRestore();
    storedRules = [
      criticalRule({
        llmProviderId: undefined,
      } as unknown as Partial<AIPostmortemRule>),
    ];

    await resolve();

    expect(generate).toHaveBeenCalledTimes(1);
    expect(
      (generate.mock.calls[0]![0] as { llmProviderId?: ObjectID })
        .llmProviderId,
    ).toBeUndefined();
    expect(feedLine()).not.toContain("LLM provider");
    expect(feedLine()).not.toContain("written with");
  });

  it("with no rule at all, as before rules existed: no pick, and nothing said of providers", async () => {
    decideIfPicked.mockRestore();
    decide.mockRestore();
    storedRules = [];

    await resolve();

    expect(generate).toHaveBeenCalledTimes(1);
    expect(
      (generate.mock.calls[0]![0] as { llmProviderId?: ObjectID })
        .llmProviderId,
    ).toBeUndefined();
    expect(feedLine()).not.toContain("LLM provider");
  });

  it("a rule's own provider drafts in a project whose default cannot", async () => {
    mockProvider(null);

    await resolve();

    expect(decide).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      pickedProviderId: new ObjectID(OPUS),
    });
    expect(generate).toHaveBeenCalledWith({
      incidentId: INCIDENT_ID,
      llmProviderId: new ObjectID(OPUS),
      aiContext: null,
    });
  });

  it("a pick that leaves nothing to write with: no draft, no model call", async () => {
    choose(nothingLeft());

    await resolve();

    expect(generate).not.toHaveBeenCalled();
    expect(feed).not.toHaveBeenCalled();
  });

  it("a pick that cannot be used falls back to the project's default, and the feed says why", async () => {
    choose(fellBack(LlmProviderFallbackReason.Unavailable));

    await resolve();

    expect(
      (generate.mock.calls[0]![0] as { llmProviderId?: ObjectID })
        .llmProviderId,
    ).toBeUndefined();
    expect(feedLine()).toContain(
      "It was written with **Azure GPT-4o**, the project's default LLM provider, because the LLM provider of postmortem rule **Critical incidents** is no longer available.",
    );
  });

  it("the switches are asked first; then the incident and its rules; then the provider - none of whose checks run for an incident no rule matches", async () => {
    storedRules = [
      criticalRule({
        incidentSeverities: [
          Object.assign(new IncidentSeverity(), {
            _id: "44444444-4444-4444-8444-444444444449",
          }),
        ],
      }),
    ];

    await resolve();

    expect(incidentRead).toHaveBeenCalledTimes(1);
    expect(decide).not.toHaveBeenCalled();
    expect(projectProvider).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it.each([
    ["a project whose default can write it", true],
    ["a project whose default cannot", false],
  ])(
    "a draft that waited for its calls is written with the provider of the rule that matches it then, in %s",
    async (_label: string, hasProjectProvider: boolean) => {
      if (!hasProjectProvider) {
        mockProvider(null);
      }

      incidentRead.mockResolvedValue({
        id: INCIDENT_ID,
        projectId: PROJECT_ID,
        incidentNumber: 42,
        postmortemNote: undefined,
        title: "Postgres primary is down",
        incidentSeverityId: new ObjectID(CRITICAL_ID),
        labels: [],
        monitors: [],
        currentIncidentStateId: ObjectID.generate(),
        postmortemDraftWaitingSince: new Date("2026-10-19T12:00:00.000Z"),
      } as unknown as Incident);
      jest
        .spyOn(IncidentPostmortemCallWait, "isResolved")
        .mockResolvedValue(true);
      jest
        .spyOn(IncidentService, "endPostmortemDraftWait")
        .mockResolvedValue(1);

      await AIIncidentPostmortemRunner.draftWaitingPostmortem({
        incidentId: INCIDENT_ID,
        now: new Date("2026-10-19T12:40:00.000Z"),
      });

      expect(generate).toHaveBeenCalledWith({
        incidentId: INCIDENT_ID,
        llmProviderId: new ObjectID(OPUS),
        aiContext: null,
      });
    },
  );

  describe("IncidentService.generatePostmortemFromAI", () => {
    beforeEach(() => {
      generate.mockRestore();
      incidentRead.mockResolvedValue({
        id: INCIDENT_ID,
        projectId: PROJECT_ID,
      } as unknown as Incident);
      jest.spyOn(AIService, "assertProjectAIEnabled").mockResolvedValue();
      jest
        .spyOn(IncidentAIContextBuilder, "buildIncidentContext")
        .mockResolvedValue({} as never);
      jest
        .spyOn(IncidentAIContextBuilder, "formatIncidentContextForPostmortem")
        .mockReturnValue({ messages: [] } as never);
    });

    function modelCall(execute: jest.SpyInstance): Record<string, unknown> {
      return execute.mock.calls[0]![0] as Record<string, unknown>;
    }

    it("hands the provider it is given to the model call", async () => {
      const execute: jest.SpyInstance = jest
        .spyOn(AIService, "executeWithLogging")
        .mockResolvedValue({ content: "## Summary", llmLog: {} } as never);

      await IncidentService.generatePostmortemFromAI({
        incidentId: INCIDENT_ID,
        llmProviderId: new ObjectID(OPUS),
      });

      expect(modelCall(execute)["llmProviderId"]).toEqual(new ObjectID(OPUS));
      expect(modelCall(execute)["feature"]).toBe("Incident Postmortem");
    });

    it("Generate with AI names none: the project's provider", async () => {
      const execute: jest.SpyInstance = jest
        .spyOn(AIService, "executeWithLogging")
        .mockResolvedValue({ content: "## Summary", llmLog: {} } as never);

      await IncidentService.generatePostmortemFromAI({
        incidentId: INCIDENT_ID,
      });

      expect(modelCall(execute)["llmProviderId"]).toBeUndefined();
    });
  });

  describe("isEnabledForProject with a rule's pick", () => {
    it("asks about the pick's provider, its AI credits and the spend limit for it", async () => {
      const limit: jest.SpyInstance = jest
        .spyOn(AIService, "getReachedProjectDailyLimit")
        .mockResolvedValue(null);
      const blocker: jest.SpyInstance = mockBalanceBlocker(null);

      expect(
        await AIIncidentPostmortemRunner.isEnabledForProject(
          PROJECT_ID,
          new ObjectID(OPUS),
        ),
      ).toBe(true);

      expect(decide).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        pickedProviderId: new ObjectID(OPUS),
      });
      expect(blocker).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        llmProvider: OPUS_ROW,
      });
      expect(limit.mock.calls[0]![0]).toMatchObject({
        projectId: PROJECT_ID,
        llmProvider: OPUS_ROW,
      });
      // The project's own provider is not what is asked about.
      expect(projectProvider).not.toHaveBeenCalled();
    });

    it("without a pick, the project's provider, and the spend limit as it always was", async () => {
      const limit: jest.SpyInstance = jest
        .spyOn(AIService, "getReachedProjectDailyLimit")
        .mockResolvedValue(null);

      expect(
        await AIIncidentPostmortemRunner.isEnabledForProject(PROJECT_ID),
      ).toBe(true);

      expect(decide).not.toHaveBeenCalled();
      expect(projectProvider).toHaveBeenCalledWith(PROJECT_ID);
      expect(limit.mock.calls[0]![0]).not.toHaveProperty("llmProvider");
    });

    it("is off when the pick leaves no provider", async () => {
      choose(nothingLeft());

      expect(
        await AIIncidentPostmortemRunner.isEnabledForProject(
          PROJECT_ID,
          new ObjectID(OPUS),
        ),
      ).toBe(false);
    });
  });

  describe("what the draft's feed item says of its provider", () => {
    function say(
      choice: RuleLlmProviderChoice,
      ruleName: string = "Critical incidents",
    ): string {
      return AIIncidentPostmortemRunner.describeDraftProvider({
        choice,
        ruleName,
      }).toString();
    }

    it("nothing when no rule picked one", () => {
      expect(
        say({
          provider: null,
          source: null,
          fallbackReason: null,
          pickedProviderId: "",
          activity: null,
        }),
      ).toBe("");
    });

    it("the provider the rule picked", () => {
      expect(say(picked())).toBe(
        " It was written with **Claude Opus**, the LLM provider of postmortem rule **Critical incidents**.",
      );
      expect(say(picked(), "")).toBe(
        " It was written with **Claude Opus**, the LLM provider of the postmortem rule.",
      );
    });

    it.each([
      [
        LlmProviderFallbackReason.Unavailable,
        LlmProviderSource.ProjectDefault,
        " It was written with **Azure GPT-4o**, the project's default LLM provider, because the LLM provider of postmortem rule **Critical incidents** is no longer available.",
      ],
      [
        LlmProviderFallbackReason.Unavailable,
        LlmProviderSource.Global,
        " It was written with **Azure GPT-4o**, the global LLM provider, because the LLM provider of postmortem rule **Critical incidents** is no longer available.",
      ],
      [
        LlmProviderFallbackReason.CreditsUsedUp,
        LlmProviderSource.ProjectDefault,
        " It was written with **Azure GPT-4o**, the project's default LLM provider, because the LLM provider of postmortem rule **Critical incidents** runs on AI credits, which are used up.",
      ],
      [
        LlmProviderFallbackReason.SpendLimitReached,
        LlmProviderSource.ProjectDefault,
        " It was written with **Azure GPT-4o**, the project's default LLM provider, because the LLM provider of postmortem rule **Critical incidents** is stopped by the project's daily AI spend limit.",
      ],
    ])(
      "%s, then %s: the one used instead, and why",
      (
        reason: LlmProviderFallbackReason,
        source: LlmProviderSource,
        expected: string,
      ) => {
        expect(say(fellBack(reason, source))).toBe(expected);
      },
    );

    it("no provider left: why the rule's was not used", () => {
      expect(say(nothingLeft())).toBe(
        " The LLM provider of postmortem rule **Critical incidents** is no longer available.",
      );
    });

    it("a provider's and a rule's names reach the feed as text: no link, no bold of their own", () => {
      const choice: RuleLlmProviderChoice = picked();
      choice.provider = {
        id: OPUS,
        name: "**Pwn** [click](https://evil.example)",
        isGlobal: false,
      };

      const text: string = say(choice, "[rule](https://evil.example)");

      expect(text).not.toContain("[click](https://evil.example)");
      expect(text).not.toContain("[rule](https://evil.example)");
      expect(text).not.toContain("**Pwn**");
      expect(text).toContain("Pwn");
    });
  });
});

describe("AIIncidentPostmortemRunner.draftWaitingPostmortems", () => {
  const NOW: Date = new Date("2026-10-19T13:00:00.000Z");
  const OTHER_INCIDENT: ObjectID = new ObjectID(
    "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  );

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("looks at every draft that waits, longest-waiting first, and lets each go on if it may", async () => {
    const find: jest.SpyInstance = jest
      .spyOn(IncidentService, "findBy")
      .mockResolvedValue([
        { id: INCIDENT_ID } as unknown as Incident,
        { id: OTHER_INCIDENT } as unknown as Incident,
      ]);
    const draftOne: jest.SpyInstance = jest
      .spyOn(AIIncidentPostmortemRunner, "draftWaitingPostmortem")
      .mockResolvedValue(undefined);

    await AIIncidentPostmortemRunner.draftWaitingPostmortems({ now: NOW });

    const findBy: Record<string, unknown> = find.mock.calls[0]![0] as Record<
      string,
      unknown
    >;

    expect(Object.keys(findBy["query"] as Record<string, unknown>)).toEqual([
      "postmortemDraftWaitingSince",
    ]);
    expect(findBy["select"]).toEqual({ _id: true });
    expect(findBy["sort"]).toEqual({
      postmortemDraftWaitingSince: SortOrder.Ascending,
    });
    expect(findBy["limit"]).toBe(100);
    expect(findBy["props"]).toEqual({ isRoot: true });
    expect(draftOne.mock.calls).toEqual([
      [{ incidentId: INCIDENT_ID, now: NOW }],
      [{ incidentId: OTHER_INCIDENT, now: NOW }],
    ]);
  });

  it("one that fails is logged, and the others go on", async () => {
    jest
      .spyOn(IncidentService, "findBy")
      .mockResolvedValue([
        { id: INCIDENT_ID } as unknown as Incident,
        { id: OTHER_INCIDENT } as unknown as Incident,
      ]);
    const draftOne: jest.SpyInstance = jest
      .spyOn(AIIncidentPostmortemRunner, "draftWaitingPostmortem")
      .mockRejectedValueOnce(new Error("model unavailable"))
      .mockResolvedValueOnce(undefined);
    const errorLog: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {
        return undefined;
      });

    await AIIncidentPostmortemRunner.draftWaitingPostmortems({ now: NOW });

    expect(draftOne).toHaveBeenCalledTimes(2);
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining(INCIDENT_ID.toString()),
    );
  });
});
