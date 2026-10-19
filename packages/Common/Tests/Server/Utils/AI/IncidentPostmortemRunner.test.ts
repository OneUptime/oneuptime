import AIIncidentPostmortemRunner from "../../../../Server/Utils/AI/SRE/IncidentPostmortemRunner";
import IncidentPostmortemCallWait from "../../../../Server/Utils/AI/SRE/IncidentPostmortemCallWait";
import AIInvestigationEngine from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import IncidentVideoCallService from "../../../../Server/Services/IncidentVideoCallService";
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
 *   resolve flow.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);

const BALANCE_BLOCKER: string = AI_BALANCE_INSUFFICIENT_MESSAGE;

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

  it("reads the incident as root, with its wait, its state and the draft's gates", async () => {
    await due();

    expect(incidentRead).toHaveBeenCalledWith({
      id: INCIDENT_ID,
      select: {
        _id: true,
        incidentNumber: true,
        postmortemNote: true,
        showPostmortemOnStatusPage: true,
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
    expect(generate).toHaveBeenCalledWith({ incidentId: INCIDENT_ID });
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
