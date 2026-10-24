import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import AIRunService from "../../../../../Server/Services/AIRunService";
import CodeRepositoryService from "../../../../../Server/Services/CodeRepositoryService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import OpenPullRequestCap from "../../../../../Server/Utils/AI/CodeFix/OpenPullRequestCap";
import CodeTaskContextBuilder from "../../../../../Server/Utils/AI/CodeTask/CodeTaskContextBuilder";
import CodeTaskGate from "../../../../../Server/Utils/AI/CodeTask/CodeTaskGate";
import CodeTaskRuns from "../../../../../Server/Utils/AI/CodeTask/CodeTaskRuns";
import ProfileFixTaskTrigger from "../../../../../Server/Utils/AI/SRE/ProfileFixTaskTrigger";
import ProfileInsightFix, {
  ProfileInsightFixResult,
  ProfileInsightFixSkip,
} from "../../../../../Server/Utils/AI/TelemetryAi/ProfileInsightFix";
import GitHubUtil from "../../../../../Server/Utils/CodeRepository/GitHub/GitHub";
import SourceLocator, {
  LocatableRepository,
} from "../../../../../Server/Utils/CodeRepository/SourceLocator";
import AIInsight from "../../../../../Models/DatabaseModels/AIInsight";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../../../Models/DatabaseModels/CodeRepository";
import { ProfileInsightEvidence } from "../../../../../Types/AI/AIInsightEvidence";
import AIInsightType from "../../../../../Types/AI/AIInsightType";
import {
  CodeTaskBlockerType,
  CodeTaskContextItem,
  CodeTaskContextType,
} from "../../../../../Types/AI/CodeTask";
import {
  TELEMETRY_AI_MAX_AUTOMATIC_FIXES_PER_DAY,
  TelemetryAiWork,
  decideTelemetryAiWork,
} from "../../../../../Types/AI/TelemetryAi";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import PositiveNumber from "../../../../../Types/PositiveNumber";

/*
 * The pull request for slow code OneUptime found (ProfileInsightFix): a
 * Code task OneUptime starts on its own in the repository that holds the
 * code, only when every gate holds - the day's share, no fix already on
 * its way, a repository the rules allow that holds the file, Code's own
 * gate, and room under the repository's open pull request cap.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5092dddd-0000-4000-8000-000000000001",
);
const CHECKOUT: string = "5092dddd-0000-4000-8000-000000000002";
const REPO_A: string = "5092dddd-0000-4000-8000-0000000000a1";
const REPO_B: string = "5092dddd-0000-4000-8000-0000000000b2";
const PROVIDER: string = "5092dddd-0000-4000-8000-0000000000c3";

const PROFILE: ProfileInsightEvidence = {
  serviceId: CHECKOUT,
  functionName: "OrderParser.parse",
  fileName: "src/orders/parser.ts",
  lineNumber: 42,
  profileType: "cpu",
  category: "cpu",
  reason: "Hot",
  ownShare: 18,
  functionSampleCount: 900,
  windowSampleCount: 5000,
  windowStartTime: "2026-10-24T08:00:04.000Z",
  windowEndTime: "2026-10-24T09:00:04.000Z",
  callers: [],
  callees: [],
};

function insight(profile: ProfileInsightEvidence | null = PROFILE): AIInsight {
  const value: AIInsight = new AIInsight();
  value.id = new ObjectID("5092dddd-0000-4000-8000-0000000000d4");
  value.projectId = PROJECT_ID;
  value.insightType = AIInsightType.ProfileHotspot;
  value.serviceName = "checkout";
  if (profile) {
    value.evidence = { profile };
  }
  return value;
}

function repository(
  id: string,
): LocatableRepository & { gitHubAppInstallationId: string } {
  return {
    id,
    name: `acme/${id.substring(id.length - 2)}`,
    organizationName: "acme",
    repositoryName: id.substring(id.length - 2),
    mainBranchName: "main",
    gitHubAppInstallationId: "42",
  };
}

// No rule: OneUptime AI may open the pull request in any repository.
const ANYWHERE: TelemetryAiWork = decideTelemetryAiWork({
  isAiEnabled: true,
  isLaneOn: true,
  rules: { rulesSetUp: false, matchingRules: [] },
});

describe("ProfileInsightFix.start", () => {
  let startedToday: number;
  let activeTaskId: string | null;
  let repositories: Array<
    LocatableRepository & { gitHubAppInstallationId: string }
  >;
  let treePaths: Map<string, Array<string>>;
  let countRuns: SpyInstance<typeof AIRunService.countBy>;
  let getBlocker: SpyInstance<typeof CodeTaskGate.getBlocker>;
  let capCheck: SpyInstance<typeof OpenPullRequestCap.checkForRepository>;
  let buildItem: SpyInstance<typeof CodeTaskContextBuilder.buildItem>;
  let startTask: SpyInstance<typeof CodeTaskRuns.startForOneUptime>;
  const createdTaskId: ObjectID = ObjectID.generate();

  beforeEach(() => {
    startedToday = 0;
    activeTaskId = null;
    repositories = [repository(REPO_A)];
    treePaths = new Map<string, Array<string>>([
      [REPO_A, ["src/orders/parser.ts", "README.md"]],
      [REPO_B, ["src/payments/charge.ts"]],
    ]);

    countRuns = jest
      .spyOn(AIRunService, "countBy")
      .mockImplementation(async () => {
        return new PositiveNumber(startedToday);
      });
    jest
      .spyOn(ProfileFixTaskTrigger, "findActiveTaskId")
      .mockImplementation(async () => {
        return activeTaskId;
      });
    jest
      .spyOn(SourceLocator, "getLocatableRepositories")
      .mockImplementation(async () => {
        return repositories;
      });
    jest
      .spyOn(GitHubUtil, "getRepositoryTreePaths")
      .mockImplementation(async (data: unknown) => {
        const name: string = (data as JSONObject)["repositoryName"] as string;
        const match: LocatableRepository | undefined = [
          repository(REPO_A),
          repository(REPO_B),
        ].find((candidate: LocatableRepository): boolean => {
          return candidate.repositoryName === name;
        });

        return match ? treePaths.get(match.id) || [] : [];
      });
    jest
      .spyOn(CodeRepositoryService, "findOneBy")
      .mockImplementation(async (data: unknown) => {
        const query: JSONObject = (data as JSONObject)["query"] as JSONObject;
        const row: CodeRepository = new CodeRepository();
        row.id = new ObjectID(query["_id"] as string);
        row.name = "acme/repo";
        row.maxOpenFixPullRequests = 3;
        return row;
      });
    jest
      .spyOn(ProjectService, "getCurrentPlan")
      .mockResolvedValue({ plan: null, isSubscriptionUnpaid: false });
    getBlocker = jest.spyOn(CodeTaskGate, "getBlocker").mockResolvedValue(null);
    capCheck = jest
      .spyOn(OpenPullRequestCap, "checkForRepository")
      .mockResolvedValue({
        allowed: true,
        limit: 3,
        paused: false,
        openCount: 1,
      });
    buildItem = jest
      .spyOn(CodeTaskContextBuilder, "buildItem")
      .mockImplementation(async (input: unknown) => {
        return {
          type: CodeTaskContextType.Profile,
          label: "Profile: OrderParser.parse in checkout",
          ...(input as object),
        } as CodeTaskContextItem;
      });
    startTask = jest
      .spyOn(CodeTaskRuns, "startForOneUptime")
      .mockImplementation(async () => {
        const run: AIRun = new AIRun();
        run.id = createdTaskId;
        return run;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("starts a Code task in the repository that holds the file, with the profile as its context", async () => {
    repositories = [repository(REPO_B), repository(REPO_A)];

    const result: ProfileInsightFixResult = await ProfileInsightFix.start({
      insight: insight(),
      work: ANYWHERE,
    });

    expect(result).toEqual({ taskId: createdTaskId });

    const call: JSONObject = startTask.mock
      .calls[0]![0] as unknown as JSONObject;
    expect(String(call["projectId"])).toBe(PROJECT_ID.toString());
    expect(String((call["repository"] as CodeRepository).id)).toBe(REPO_A);
    expect(String(call["triggeredByAiInsightId"])).toBe(
      insight().id!.toString(),
    );
    expect(call["llmProviderId"]).toBeUndefined();
    expect((call["message"] as string).split("\n")[0]).toBe(
      "Make OrderParser.parse in src/orders/parser.ts faster",
    );
    expect(call["message"]).toContain(
      "OneUptime found this in the service's profiles on its own.",
    );
    expect(call["message"]).toContain("say why and change nothing");

    const context: JSONObject = buildItem.mock
      .calls[0]![0] as unknown as JSONObject;
    expect(context).toEqual({
      type: CodeTaskContextType.Profile,
      serviceId: CHECKOUT,
      functionName: "OrderParser.parse",
      fileName: "src/orders/parser.ts",
      profileType: "cpu",
      startTime: "2026-10-24T08:00:04.000Z",
      endTime: "2026-10-24T09:00:04.000Z",
    });
    // Read as OneUptime: nobody is asking.
    expect(
      (buildItem.mock.calls[0]![1] as unknown as JSONObject)["props"],
    ).toEqual({ isRoot: true });
  });

  test("a regression is asked with the window it is compared with", async () => {
    await ProfileInsightFix.start({
      insight: insight({
        ...PROFILE,
        reason: "Grew",
        ownShare: 12,
        ownShareBefore: 2,
        baselineStartTime: "2026-10-23T08:00:04.000Z",
        baselineEndTime: "2026-10-23T09:00:04.000Z",
      }),
      work: ANYWHERE,
    });

    const context: JSONObject = buildItem.mock
      .calls[0]![0] as unknown as JSONObject;
    expect(context["beforeStartTime"]).toBe("2026-10-23T08:00:04.000Z");
    expect(context["beforeEndTime"]).toBe("2026-10-23T09:00:04.000Z");

    const message: string = (
      startTask.mock.calls[0]![0] as unknown as JSONObject
    )["message"] as string;
    expect(message).toContain("grew from 2.0% to 12%");
  });

  test("the rules' LLM provider is the task's", async () => {
    await ProfileInsightFix.start({
      insight: insight(),
      work: { ...ANYWHERE, llmProviderId: PROVIDER },
    });

    expect(
      String(
        (startTask.mock.calls[0]![0] as unknown as JSONObject)["llmProviderId"],
      ),
    ).toBe(PROVIDER);
  });

  test("an insight with no profile evidence starts nothing", async () => {
    await expect(
      ProfileInsightFix.start({ insight: insight(null), work: ANYWHERE }),
    ).resolves.toEqual({ skip: ProfileInsightFixSkip.NoEvidence });
    expect(startTask).not.toHaveBeenCalled();
  });

  test("the day's share opened: nothing more today", async () => {
    startedToday = TELEMETRY_AI_MAX_AUTOMATIC_FIXES_PER_DAY;

    await expect(
      ProfileInsightFix.start({ insight: insight(), work: ANYWHERE }),
    ).resolves.toEqual({ skip: ProfileInsightFixSkip.DailyLimit });
    expect(startTask).not.toHaveBeenCalled();
  });

  test("the day's share counts the tasks OneUptime started on its own today", async () => {
    await ProfileInsightFix.countStartedToday(PROJECT_ID);

    const query: JSONObject = (
      countRuns.mock.calls[0]![0] as unknown as JSONObject
    )["query"] as JSONObject;
    expect(query["codeFixTaskType"]).toBe("CodeRequest");
    expect(query["runType"]).toBe("CodeFix");
    expect(Object.keys(query).sort()).toEqual(
      [
        "codeFixTaskType",
        "codeTaskId",
        "createdAt",
        "projectId",
        "runType",
        "triggeredByAiInsightId",
        "userId",
      ].sort(),
    );
  });

  test("a person's fix of the same function on its way is this insight's fix", async () => {
    activeTaskId = "5092dddd-0000-4000-8000-0000000000e5";

    await expect(
      ProfileInsightFix.start({ insight: insight(), work: ANYWHERE }),
    ).resolves.toEqual({ taskId: new ObjectID(activeTaskId) });
    expect(startTask).not.toHaveBeenCalled();
  });

  test("no repository connected through the GitHub App: nothing", async () => {
    repositories = [];

    await expect(
      ProfileInsightFix.start({ insight: insight(), work: ANYWHERE }),
    ).resolves.toEqual({ skip: ProfileInsightFixSkip.NoRepository });
  });

  test("only the repositories the rules allow are looked in", async () => {
    repositories = [repository(REPO_A), repository(REPO_B)];

    await expect(
      ProfileInsightFix.start({
        insight: insight(),
        work: {
          ...ANYWHERE,
          repositories: { isEveryRepository: false, repositoryIds: [REPO_B] },
        },
      }),
    ).resolves.toEqual({
      taskId: createdTaskId,
    });

    // REPO_B is the only one allowed: there is no telling where else.
    expect(
      String(
        (
          (startTask.mock.calls[0]![0] as unknown as JSONObject)[
            "repository"
          ] as CodeRepository
        ).id,
      ),
    ).toBe(REPO_B);

    startTask.mockClear();

    await expect(
      ProfileInsightFix.start({
        insight: insight(),
        work: {
          ...ANYWHERE,
          repositories: { isEveryRepository: false, repositoryIds: [] },
        },
      }),
    ).resolves.toEqual({ skip: ProfileInsightFixSkip.NoRepository });
    expect(startTask).not.toHaveBeenCalled();
  });

  test("several repositories and none holds the file: there is no telling which", async () => {
    repositories = [repository(REPO_A), repository(REPO_B)];
    treePaths.set(REPO_A, ["other.ts"]);

    await expect(
      ProfileInsightFix.start({ insight: insight(), work: ANYWHERE }),
    ).resolves.toEqual({ skip: ProfileInsightFixSkip.RepositoryNotFound });
  });

  test("Code's own gate says no: nothing, in its words", async () => {
    getBlocker.mockResolvedValue({
      type: CodeTaskBlockerType.RunnerNotOnline,
      message: "The Runner this repository picks is not online.",
    });

    await expect(
      ProfileInsightFix.start({ insight: insight(), work: ANYWHERE }),
    ).resolves.toEqual({
      skip: ProfileInsightFixSkip.Blocked,
      detail: "The Runner this repository picks is not online.",
    });
    expect(startTask).not.toHaveBeenCalled();
  });

  test("Code's gate is asked as a person asking would be, the plan and the bill included", async () => {
    jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
      plan: "Free" as never,
      isSubscriptionUnpaid: true,
    });

    await ProfileInsightFix.start({ insight: insight(), work: ANYWHERE });

    const gate: JSONObject = getBlocker.mock
      .calls[0]![0] as unknown as JSONObject;
    expect(gate["props"]).toEqual({
      isRoot: true,
      currentPlan: "Free",
      isSubscriptionUnpaid: true,
    });
    expect(gate["canAsk"]).toBe(true);
  });

  test("the repository at its cap of open AI pull requests: nothing", async () => {
    capCheck.mockResolvedValue({
      allowed: false,
      limit: 3,
      paused: false,
      openCount: 3,
    });

    await expect(
      ProfileInsightFix.start({ insight: insight(), work: ANYWHERE }),
    ).resolves.toEqual({ skip: ProfileInsightFixSkip.AtPullRequestCap });
    expect(
      (capCheck.mock.calls[0]![0] as unknown as JSONObject)["configuredLimit"],
    ).toBe(3);
  });

  test("never throws: a failure is a skip", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    startTask.mockRejectedValue(new Error("db down"));

    await expect(
      ProfileInsightFix.start({ insight: insight(), work: ANYWHERE }),
    ).resolves.toEqual({ skip: ProfileInsightFixSkip.Failed });
  });

  test("the gates are asked cheapest first: a day's share spent reads no repository", async () => {
    startedToday = TELEMETRY_AI_MAX_AUTOMATIC_FIXES_PER_DAY + 1;
    const locate: SpyInstance<typeof SourceLocator.getLocatableRepositories> =
      jest.spyOn(SourceLocator, "getLocatableRepositories");

    await ProfileInsightFix.start({ insight: insight(), work: ANYWHERE });

    expect(locate).not.toHaveBeenCalled();
    expect(getBlocker).not.toHaveBeenCalled();
  });
});
