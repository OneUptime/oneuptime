import ProfileFixTaskTrigger, {
  PROFILE_FIX_ALREADY_RUNNING_MESSAGE,
  PROFILE_FIX_INSIGHT_HAS_FIX_MESSAGE,
  PROFILE_FIX_INSIGHT_NOT_FOUND_MESSAGE,
  PROFILE_FIX_PICK_REPOSITORY_MESSAGE,
  PROFILE_FIX_REPOSITORY_NOT_AVAILABLE_MESSAGE,
  ProfileFixRead,
  ProfileFixRequest,
} from "../../../../../Server/Utils/AI/SRE/ProfileFixTaskTrigger";
import SubjectCodeFixRun from "../../../../../Server/Utils/AI/SRE/SubjectCodeFixRun";
import CodeTaskAccess from "../../../../../Server/Utils/AI/CodeTask/CodeTaskAccess";
import CodeTaskContextBuilder from "../../../../../Server/Utils/AI/CodeTask/CodeTaskContextBuilder";
import CodeTaskGate from "../../../../../Server/Utils/AI/CodeTask/CodeTaskGate";
import CodeTaskRuns from "../../../../../Server/Utils/AI/CodeTask/CodeTaskRuns";
import SourceLocator, {
  LocatableRepository,
  SourceLink,
} from "../../../../../Server/Utils/CodeRepository/SourceLocator";
import { ProfileFunctionEvidence } from "../../../../../Server/Utils/Profile/ProfileEvidence";
import AIInsightService from "../../../../../Server/Services/AIInsightService";
import AIRunService from "../../../../../Server/Services/AIRunService";
import AIService, {
  AI_DISABLED_MESSAGE,
} from "../../../../../Server/Services/AIService";
import ServiceService from "../../../../../Server/Services/ServiceService";
import AIInsight from "../../../../../Models/DatabaseModels/AIInsight";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../../../Models/DatabaseModels/CodeRepository";
import AIInsightStatus from "../../../../../Types/AI/AIInsightStatus";
import AIInsightType from "../../../../../Types/AI/AIInsightType";
import Service from "../../../../../Models/DatabaseModels/Service";
import {
  CodeTaskBlockerType,
  CodeTaskContextItem,
  CodeTaskContextType,
} from "../../../../../Types/AI/CodeTask";
import CodeFixTaskContext from "../../../../../Types/AI/CodeFixTaskContext";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import { ProfileFrameOrigin } from "../../../../../Utils/Profiles/ProfileFrames";
import {
  ProfileCategory,
  ProfileValueUnit,
} from "../../../../../Utils/Profiles/ProfileTypes";
import SuggestionOffer from "../../../../../Utils/Suggestions/SuggestionOffer";
import {
  PROFILE_NOT_WORTH_FIXING_MESSAGE,
  ProfileFixReason,
  ProfileFixSuggestion,
} from "../../../../../Utils/Suggestions/ProfileFixSuggestion";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * "Fix with AI" from the Profiler. The function panel asks getSuggestion
 * what to draw; the create route (createFixTask) checks the very same
 * gates, in the same order, so the panel never offers a fix the server
 * then refuses: the project's AI switch, the function worth a fix (read
 * under the person's own scope), no fix already on its way, a repository
 * that holds the code (or one the person picks), and Code's own gate. The
 * fix is an ordinary Code request with the profile as its context.
 */

const projectId: ObjectID = ObjectID.generate();
const serviceId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();
const props: DatabaseCommonInteractionProps = {
  tenantId: projectId,
  userId,
} as DatabaseCommonInteractionProps;

const WINDOW: { startTime: Date; endTime: Date } = {
  startTime: new Date("2026-10-20T11:00:00.000Z"),
  endTime: new Date("2026-10-20T12:00:00.000Z"),
};

const REQUEST: ProfileFixRequest = {
  projectId,
  props,
  serviceId,
  functionName: "parseOrder",
  fileName: "src/orders/parse.ts",
  profileType: "cpu",
  window: WINDOW,
};

const CHECKOUT_REPOSITORY: LocatableRepository & {
  gitHubAppInstallationId: string;
} = {
  id: "90000000-0000-4000-8000-0000000000c1",
  name: "acme/checkout",
  organizationName: "acme",
  repositoryName: "checkout",
  mainBranchName: "main",
  gitHubAppInstallationId: "1234",
};

const PLATFORM_REPOSITORY: LocatableRepository & {
  gitHubAppInstallationId: string;
} = {
  id: "90000000-0000-4000-8000-0000000000c2",
  name: "acme/platform",
  organizationName: "acme",
  repositoryName: "platform",
  mainBranchName: "main",
  gitHubAppInstallationId: "1234",
};

function evidence(
  change: Partial<ProfileFunctionEvidence> = {},
): ProfileFunctionEvidence {
  return {
    functionName: "parseOrder",
    fileName: "src/orders/parse.ts",
    lineNumber: 88,
    frameType: "",
    origin: ProfileFrameOrigin.Own,
    kind: {
      selection: "cpu",
      category: ProfileCategory.Cpu,
      queryTypes: ["cpu"],
      unit: ProfileValueUnit.Nanoseconds,
    },
    window: WINDOW,
    selfValue: 0,
    totalValue: 560,
    ownValue: 420,
    sampleCount: 16400,
    windowTotal: 1000,
    windowSampleCount: 29500,
    selfShare: 0,
    totalShare: 56,
    ownShare: 42,
    callerChains: [],
    callees: [],
    otherFiles: [],
    truncated: false,
    ...change,
  };
}

function read(change: Partial<ProfileFunctionEvidence> = {}): ProfileFixRead {
  const functionEvidence: ProfileFunctionEvidence = evidence(change);

  return {
    evidence: functionEvidence,
    hotspot: {
      category: ProfileCategory.Cpu,
      isOwnCode: functionEvidence.origin === ProfileFrameOrigin.Own,
      ownShare: functionEvidence.ownShare,
      functionSampleCount: functionEvidence.sampleCount,
      windowSampleCount: functionEvidence.windowSampleCount,
      ...(functionEvidence.before
        ? { ownShareBefore: functionEvidence.before.ownShare }
        : {}),
    },
  };
}

function aiSwitch(isOn: boolean): void {
  jest.spyOn(AIService, "isProjectAIEnabled").mockResolvedValue(isOn);
  if (isOn) {
    jest.spyOn(AIService, "assertProjectAIEnabled").mockResolvedValue();
  } else {
    jest
      .spyOn(AIService, "assertProjectAIEnabled")
      .mockRejectedValue(new BadDataException(AI_DISABLED_MESSAGE));
  }
}

interface World {
  readEvidence: jest.SpiedFunction<typeof ProfileFixTaskTrigger.readEvidence>;
  findActive: jest.SpiedFunction<typeof AIRunService.findBy>;
  locatable: jest.SpiedFunction<typeof SourceLocator.getLocatableRepositories>;
  matchFrames: jest.SpiedFunction<typeof SourceLocator.matchFrames>;
  canAsk: jest.SpiedFunction<typeof CodeTaskAccess.canAskInRepository>;
  blocker: jest.SpiedFunction<typeof CodeTaskGate.getBlocker>;
  start: jest.SpiedFunction<typeof CodeTaskRuns.start>;
  buildItem: jest.SpiedFunction<typeof CodeTaskContextBuilder.buildItem>;
}

/*
 * A project where the function is hot, the GitHub App reaches acme/checkout
 * (which holds the file), the person may ask there and nothing is in Code's
 * way. Each test changes one thing.
 */
function world(change?: {
  read?: ProfileFixRead | null;
  activeRuns?: Array<AIRun>;
  locatable?: Array<LocatableRepository & { gitHubAppInstallationId: string }>;
  located?: LocatableRepository | null;
  connected?: boolean;
  canAsk?: boolean;
  blocker?: { type: CodeTaskBlockerType; message: string } | null;
}): World {
  const located: LocatableRepository | null =
    change && "located" in change ? change.located! : CHECKOUT_REPOSITORY;

  const world: World = {
    readEvidence: jest
      .spyOn(ProfileFixTaskTrigger, "readEvidence")
      .mockResolvedValue(change && "read" in change ? change.read! : read()),
    findActive: jest
      .spyOn(AIRunService, "findBy")
      .mockResolvedValue(change?.activeRuns || []),
    locatable: jest
      .spyOn(SourceLocator, "getLocatableRepositories")
      .mockResolvedValue(
        change?.locatable || [CHECKOUT_REPOSITORY, PLATFORM_REPOSITORY],
      ),
    matchFrames: jest.spyOn(SourceLocator, "matchFrames").mockResolvedValue(
      located
        ? [
            {
              fileName: "src/orders/parse.ts",
              lineNumber: 88,
              repositoryId: located.id,
              repositoryName: located.name,
              path: "src/orders/parse.ts",
              url: "https://github.com/acme/checkout/blob/main/src/orders/parse.ts#L88",
            } as SourceLink,
          ]
        : [],
    ),
    canAsk: jest
      .spyOn(CodeTaskAccess, "canAskInRepository")
      .mockResolvedValue(change?.canAsk ?? true),
    blocker: jest
      .spyOn(CodeTaskGate, "getBlocker")
      .mockResolvedValue(change?.blocker || null),
    start: jest.spyOn(CodeTaskRuns, "start").mockResolvedValue({
      id: new ObjectID("70000000-0000-4000-8000-0000000000f1"),
    } as AIRun),
    buildItem: jest
      .spyOn(CodeTaskContextBuilder, "buildItem")
      .mockResolvedValue({
        type: CodeTaskContextType.Profile,
        label: "Profile: parseOrder in checkout",
        functionName: "parseOrder",
      } as CodeTaskContextItem),
  };

  jest
    .spyOn(SubjectCodeFixRun, "hasGitHubAppConnectedRepository")
    .mockResolvedValue(change?.connected ?? true);
  jest.spyOn(CodeTaskAccess, "getReadableRepository").mockResolvedValue(
    Object.assign(new CodeRepository(), {
      _id: CHECKOUT_REPOSITORY.id,
      name: CHECKOUT_REPOSITORY.name,
    }) as CodeRepository,
  );
  jest.spyOn(CodeTaskGate, "assertCanStart").mockResolvedValue();
  jest
    .spyOn(ServiceService, "findOneBy")
    .mockResolvedValue(
      Object.assign(new Service(), { name: "checkout" }) as Service,
    );

  return world;
}

function activeFixRun(): AIRun {
  return {
    id: new ObjectID("70000000-0000-4000-8000-0000000000f2"),
    codeTaskId: new ObjectID("70000000-0000-4000-8000-0000000000f3"),
    taskContext: {
      request: {
        message: "Make parseOrder faster",
        context: [
          {
            type: CodeTaskContextType.Profile,
            label: "Profile: parseOrder",
            serviceId: serviceId.toString().toUpperCase(),
            functionName: "parseOrder",
            fileName: "src/orders/parse.ts",
          },
        ],
      },
    } as unknown as CodeFixTaskContext,
  } as unknown as AIRun;
}

beforeEach(() => {
  aiSwitch(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what the function panel is offered", () => {
  test("a hot function of a repository's code: the fix, in that repository", async () => {
    world();

    const suggestion: ProfileFixSuggestion =
      await ProfileFixTaskTrigger.getSuggestion(REQUEST);

    expect(suggestion.offer).toBe(SuggestionOffer.Act);
    expect(suggestion.reason).toBe(ProfileFixReason.Hot);
    expect(suggestion.repository).toEqual({
      id: CHECKOUT_REPOSITORY.id,
      name: "acme/checkout",
    });
    expect(suggestion.repositories).toEqual([]);
    expect(suggestion.evidence!.ownShare).toBe(42);
  });

  test("AI off: nothing, and the profile is not even read", async () => {
    aiSwitch(false);
    const spies: World = world();

    expect((await ProfileFixTaskTrigger.getSuggestion(REQUEST)).offer).toBe(
      SuggestionOffer.None,
    );
    expect(spies.readEvidence).not.toHaveBeenCalled();
  });

  test("a function not worth a fix - or that took no time - is offered nothing", async () => {
    world({ read: read({ origin: ProfileFrameOrigin.Runtime }) });
    expect((await ProfileFixTaskTrigger.getSuggestion(REQUEST)).offer).toBe(
      SuggestionOffer.None,
    );

    jest.restoreAllMocks();
    aiSwitch(true);
    world({ read: null });
    expect((await ProfileFixTaskTrigger.getSuggestion(REQUEST)).offer).toBe(
      SuggestionOffer.None,
    );
  });

  test("a fix already on its way for the function: a link to its task", async () => {
    const spies: World = world({ activeRuns: [activeFixRun()] });

    const suggestion: ProfileFixSuggestion =
      await ProfileFixTaskTrigger.getSuggestion(REQUEST);

    expect(suggestion.offer).toBe(SuggestionOffer.InProgress);
    expect(suggestion.taskId).toBe("70000000-0000-4000-8000-0000000000f3");
    // No repository is read for a fix that is already under way.
    expect(spies.locatable).not.toHaveBeenCalled();
  });

  test("a fix on its way for another function does not count", async () => {
    const other: AIRun = activeFixRun();
    (
      other.taskContext as unknown as {
        request: { context: Array<{ functionName: string }> };
      }
    ).request.context[0]!.functionName = "validateCart";
    world({ activeRuns: [other] });

    expect((await ProfileFixTaskTrigger.getSuggestion(REQUEST)).offer).toBe(
      SuggestionOffer.Act,
    );
  });

  test("no repository connected at all: the step to connect one", async () => {
    world({ locatable: [], connected: false });

    const suggestion: ProfileFixSuggestion =
      await ProfileFixTaskTrigger.getSuggestion(REQUEST);

    expect(suggestion.offer).toBe(SuggestionOffer.SetUp);
    expect(suggestion.blocker!.type).toBe(
      CodeTaskBlockerType.RepositoryNotConnected,
    );
  });

  test("repositories connected, but none the person may read: nothing they could do", async () => {
    world({ locatable: [], connected: true });

    expect((await ProfileFixTaskTrigger.getSuggestion(REQUEST)).offer).toBe(
      SuggestionOffer.None,
    );
  });

  test("no repository found to hold the file: the ones the person can ask in, to pick from", async () => {
    world({ located: null });

    const suggestion: ProfileFixSuggestion =
      await ProfileFixTaskTrigger.getSuggestion(REQUEST);

    expect(suggestion.offer).toBe(SuggestionOffer.Act);
    expect(suggestion.repository).toBeNull();
    expect(
      suggestion.repositories.map((repository: { name: string }) => {
        return repository.name;
      }),
    ).toEqual(["acme/checkout", "acme/platform"]);
  });

  test("the person may not ask AI where the code is: nothing", async () => {
    world({ canAsk: false });

    expect((await ProfileFixTaskTrigger.getSuggestion(REQUEST)).offer).toBe(
      SuggestionOffer.None,
    );
  });

  test("Code's gate says no: the step it names", async () => {
    world({
      blocker: {
        type: CodeTaskBlockerType.NoAiCredits,
        message: "The project has no AI credits left.",
      },
    });

    const suggestion: ProfileFixSuggestion =
      await ProfileFixTaskTrigger.getSuggestion(REQUEST);

    expect(suggestion.offer).toBe(SuggestionOffer.SetUp);
    expect(suggestion.blocker!.type).toBe(CodeTaskBlockerType.NoAiCredits);
  });
});

describe("starting the fix", () => {
  test("a Code request in the repository that holds the code, with the profile as its context", async () => {
    const spies: World = world();

    const created: { taskId: string } =
      await ProfileFixTaskTrigger.createFixTask(REQUEST);

    expect(created.taskId).toBe("70000000-0000-4000-8000-0000000000f1");
    expect(spies.buildItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: CodeTaskContextType.Profile,
        serviceId: serviceId.toString(),
        functionName: "parseOrder",
        fileName: "src/orders/parse.ts",
        profileType: "cpu",
        startTime: WINDOW.startTime.toISOString(),
        endTime: WINDOW.endTime.toISOString(),
      }),
      { projectId, props },
    );

    const started: Parameters<typeof CodeTaskRuns.start>[0] =
      spies.start.mock.calls[0]![0];

    expect(started.projectId).toBe(projectId);
    expect(started.userId).toBe(userId);
    expect(started.repository.id!.toString()).toBe(CHECKOUT_REPOSITORY.id);
    expect(started.context).toHaveLength(1);
    // The ask says what was found, in plain words, its first line the title.
    expect(started.message.split("\n")[0]).toBe(
      "Make parseOrder in src/orders/parse.ts faster",
    );
    expect(started.message).toContain("It takes 42% of checkout's CPU time");
  });

  test("the person's own words, when they edited the ask", async () => {
    const spies: World = world();

    await ProfileFixTaskTrigger.createFixTask({
      ...REQUEST,
      message: "  Cache the parsed order per request  ",
    });

    expect(spies.start.mock.calls[0]![0].message).toBe(
      "Cache the parsed order per request",
    );
  });

  test("compared with an earlier window, the context carries it", async () => {
    const spies: World = world();
    const beforeWindow: { startTime: Date; endTime: Date } = {
      startTime: new Date("2026-10-20T10:00:00.000Z"),
      endTime: new Date("2026-10-20T11:00:00.000Z"),
    };

    await ProfileFixTaskTrigger.createFixTask({ ...REQUEST, beforeWindow });

    expect(spies.buildItem).toHaveBeenCalledWith(
      expect.objectContaining({
        beforeStartTime: beforeWindow.startTime.toISOString(),
        beforeEndTime: beforeWindow.endTime.toISOString(),
      }),
      expect.anything(),
    );
  });

  test("AI off: refused in the switch's own words, before the profile is read", async () => {
    aiSwitch(false);
    const spies: World = world();

    await expect(ProfileFixTaskTrigger.createFixTask(REQUEST)).rejects.toThrow(
      AI_DISABLED_MESSAGE,
    );
    expect(spies.readEvidence).not.toHaveBeenCalled();
    expect(spies.start).not.toHaveBeenCalled();
  });

  test("a function not worth a fix is refused with the rule", async () => {
    const spies: World = world({ read: read({ ownShare: 1 }) });

    await expect(ProfileFixTaskTrigger.createFixTask(REQUEST)).rejects.toThrow(
      PROFILE_NOT_WORTH_FIXING_MESSAGE,
    );
    expect(spies.start).not.toHaveBeenCalled();
  });

  test("a fix already on its way is not started twice", async () => {
    const spies: World = world({ activeRuns: [activeFixRun()] });

    await expect(ProfileFixTaskTrigger.createFixTask(REQUEST)).rejects.toThrow(
      PROFILE_FIX_ALREADY_RUNNING_MESSAGE,
    );
    expect(spies.start).not.toHaveBeenCalled();
  });

  test("no repository found to hold the code: the person is asked to pick one", async () => {
    world({ located: null });

    await expect(ProfileFixTaskTrigger.createFixTask(REQUEST)).rejects.toThrow(
      PROFILE_FIX_PICK_REPOSITORY_MESSAGE,
    );
  });

  test("a picked repository is used - but only one the GitHub App reaches for them", async () => {
    const spies: World = world({ located: null });

    await ProfileFixTaskTrigger.createFixTask({
      ...REQUEST,
      repositoryId: new ObjectID(PLATFORM_REPOSITORY.id),
    });

    expect(CodeTaskAccess.getReadableRepository).toHaveBeenCalledWith(
      expect.objectContaining({
        repositoryId: new ObjectID(PLATFORM_REPOSITORY.id),
      }),
    );
    expect(spies.start).toHaveBeenCalledTimes(1);

    jest.restoreAllMocks();
    aiSwitch(true);
    world({ locatable: [CHECKOUT_REPOSITORY] });

    await expect(
      ProfileFixTaskTrigger.createFixTask({
        ...REQUEST,
        repositoryId: new ObjectID(PLATFORM_REPOSITORY.id),
      }),
    ).rejects.toThrow(PROFILE_FIX_REPOSITORY_NOT_AVAILABLE_MESSAGE);
  });

  test("Code's gate refusing stops the start", async () => {
    const spies: World = world();
    jest
      .spyOn(CodeTaskGate, "assertCanStart")
      .mockRejectedValue(new BadDataException("No AI credits left."));

    await expect(ProfileFixTaskTrigger.createFixTask(REQUEST)).rejects.toThrow(
      "No AI credits left.",
    );
    expect(spies.start).not.toHaveBeenCalled();
  });
});

/*
 * "Fix with AI" on a slow-code finding - what an AI rule that asks before
 * fixing leaves to a person: the same task, naming the finding, which then
 * links the task.
 */
describe("starting the fix from a slow-code finding", () => {
  const insightId: ObjectID = new ObjectID(
    "70000000-0000-4000-8000-0000000000a9",
  );

  function finding(fixAiRunId?: ObjectID): AIInsight {
    return Object.assign(new AIInsight(), {
      _id: insightId.toString(),
      ...(fixAiRunId ? { fixAiRunId } : {}),
    }) as AIInsight;
  }

  test("the task names the finding, and the finding links the task, only while it has none", async () => {
    const spies: World = world();
    const readFinding: jest.SpiedFunction<typeof AIInsightService.findOneBy> =
      jest.spyOn(AIInsightService, "findOneBy").mockResolvedValue(finding());
    const linkFinding: jest.SpiedFunction<typeof AIInsightService.updateOneBy> =
      jest.spyOn(AIInsightService, "updateOneBy").mockResolvedValue(1);

    const created: { taskId: string } =
      await ProfileFixTaskTrigger.createFixTask({ ...REQUEST, insightId });

    // The finding is read as the person: one of the project's slow code findings.
    const read: Record<string, unknown> = readFinding.mock
      .calls[0]![0] as never;
    const readQuery: Record<string, unknown> = read["query"] as never;

    expect(read["props"]).toBe(props);
    expect(readQuery["_id"]).toBe(insightId.toString());
    expect(readQuery["projectId"]).toBe(projectId);
    expect(readQuery["insightType"]).toBe(AIInsightType.ProfileHotspot);

    // The task is the person's request, naming the finding.
    const started: Parameters<typeof CodeTaskRuns.start>[0] =
      spies.start.mock.calls[0]![0];

    expect(started.userId).toBe(userId);
    expect(started.triggeredByAiInsightId).toBe(insightId);

    // The finding links the task: only an open one, and only while it has none.
    const link: Record<string, unknown> = linkFinding.mock
      .calls[0]![0] as never;
    const linkQuery: Record<string, unknown> = link["query"] as never;
    const linkData: Record<string, unknown> = link["data"] as never;

    expect(linkQuery["_id"]).toBe(insightId.toString());
    expect(linkQuery["projectId"]).toBe(projectId);
    expect(linkQuery["fixAiRunId"]).toBeDefined();
    expect(JSON.stringify(linkQuery["status"])).toContain(
      AIInsightStatus.ActionRequired,
    );
    expect(JSON.stringify(linkQuery["status"])).not.toContain(
      AIInsightStatus.Resolved,
    );
    expect(linkData["status"]).toBe(AIInsightStatus.FixOpened);
    expect(String(linkData["fixAiRunId"])).toBe(created.taskId);
    expect(link["props"]).toEqual({ isRoot: true });
  });

  test("a finding the person may not read, or that is not slow code, is refused before anything starts", async () => {
    const spies: World = world();
    jest.spyOn(AIInsightService, "findOneBy").mockResolvedValue(null);
    const linkFinding: jest.SpiedFunction<typeof AIInsightService.updateOneBy> =
      jest.spyOn(AIInsightService, "updateOneBy").mockResolvedValue(1);

    await expect(
      ProfileFixTaskTrigger.createFixTask({ ...REQUEST, insightId }),
    ).rejects.toThrow(PROFILE_FIX_INSIGHT_NOT_FOUND_MESSAGE);
    expect(spies.readEvidence).not.toHaveBeenCalled();
    expect(spies.start).not.toHaveBeenCalled();
    expect(linkFinding).not.toHaveBeenCalled();
  });

  test("a finding with a fix already linked is not given a second one", async () => {
    const spies: World = world();
    jest
      .spyOn(AIInsightService, "findOneBy")
      .mockResolvedValue(finding(ObjectID.generate()));

    await expect(
      ProfileFixTaskTrigger.createFixTask({ ...REQUEST, insightId }),
    ).rejects.toThrow(PROFILE_FIX_INSIGHT_HAS_FIX_MESSAGE);
    expect(spies.start).not.toHaveBeenCalled();
  });

  test("without a finding, nothing is read or linked: the Profiler's own Fix with AI", async () => {
    const spies: World = world();
    const readFinding: jest.SpiedFunction<typeof AIInsightService.findOneBy> =
      jest.spyOn(AIInsightService, "findOneBy");
    const linkFinding: jest.SpiedFunction<typeof AIInsightService.updateOneBy> =
      jest.spyOn(AIInsightService, "updateOneBy");

    await ProfileFixTaskTrigger.createFixTask(REQUEST);

    expect(readFinding).not.toHaveBeenCalled();
    expect(linkFinding).not.toHaveBeenCalled();
    expect(
      spies.start.mock.calls[0]![0].triggeredByAiInsightId,
    ).toBeUndefined();
  });
});

describe("the ask, in plain words", () => {
  test("memory is asked to use less of it, locks to wait less, and growth says from and to", () => {
    const memory: string = ProfileFixTaskTrigger.buildRequestMessage({
      evidence: evidence({
        kind: {
          selection: "memory",
          category: ProfileCategory.Memory,
          queryTypes: ["inuse_space"],
          unit: ProfileValueUnit.Bytes,
        },
      }),
      reason: ProfileFixReason.Hot,
    });

    expect(memory.split("\n")[0]).toBe(
      "Make parseOrder in src/orders/parse.ts use less memory",
    );

    const locks: string = ProfileFixTaskTrigger.buildRequestMessage({
      evidence: evidence({
        kind: {
          selection: "locks",
          category: ProfileCategory.Locks,
          queryTypes: ["mutex"],
          unit: ProfileValueUnit.Nanoseconds,
        },
      }),
      reason: ProfileFixReason.Hot,
    });

    expect(locks.split("\n")[0]).toBe(
      "Make parseOrder in src/orders/parse.ts wait less on locks",
    );

    const grew: string = ProfileFixTaskTrigger.buildRequestMessage({
      evidence: evidence({
        before: {
          window: {
            startTime: new Date("2026-10-20T10:00:00.000Z"),
            endTime: new Date("2026-10-20T11:00:00.000Z"),
          },
          selfShare: 0,
          totalShare: 20,
          ownShare: 12,
          sampleCount: 3000,
          windowSampleCount: 25000,
        },
      }),
      reason: ProfileFixReason.Grew,
      serviceName: "checkout",
    });

    expect(grew).toContain(
      "Its share of checkout's CPU time grew from 12% to 42%",
    );
    // The window as a person reads it, from the window before to now.
    expect(grew).toContain("between 10:00 and 12:00 UTC on 2026-10-20.");
  });

  test("times and counts read as a person writes them, never as ISO strings", () => {
    const hot: string = ProfileFixTaskTrigger.buildRequestMessage({
      evidence: evidence({ windowSampleCount: 16400 }),
      reason: ProfileFixReason.Hot,
      serviceName: "checkout",
    });

    expect(hot).toContain(
      "in 16,400 samples between 11:00 and 12:00 UTC on 2026-10-20.",
    );
    expect(hot).not.toContain(".000Z");
    expect(hot).not.toContain("T11:00");
  });

  test("a window across midnight names both dates", () => {
    expect(
      ProfileFixTaskTrigger.describeWindow(
        new Date("2026-10-19T23:30:00.000Z"),
        new Date("2026-10-20T00:30:00.000Z"),
      ),
    ).toBe("between 2026-10-19 23:30 and 2026-10-20 00:30 UTC");
    expect(
      ProfileFixTaskTrigger.describeWindow(
        new Date("2026-10-20T08:55:41.123Z"),
        new Date("2026-10-20T09:55:41.123Z"),
      ),
    ).toBe("between 08:55 and 09:55 UTC on 2026-10-20");
  });
});
