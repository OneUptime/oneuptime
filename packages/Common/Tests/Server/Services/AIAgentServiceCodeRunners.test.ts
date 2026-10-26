import AIAgentService from "../../../Server/Services/AIAgentService";
import RunnerService from "../../../Server/Services/RunnerService";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import AIAgent, {
  AIAgentConnectionStatus,
} from "../../../Models/DatabaseModels/AIAgent";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { RUNNER_ALIVE_WINDOW_IN_MINUTES } from "../../../Types/Runner/RunnerLiveStatus";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * WHAT WORKS IN A REPOSITORY THAT PICKS NO RUNNER.
 *
 * A code repository that picks none of its project's Runners works on a
 * global Runner - a Runner OneUptime runs for every project (the bundled
 * one, and any a master admin adds) - while its project uses global
 * Runners, and on an AI agent of the project's own, from before Runners,
 * either way. These are what the server asks before handing such a
 * repository's work on: whether one is alive now.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "7c2d3e4f-1111-4222-8333-944455556666",
);

function agent(data: {
  lastAlive?: Date | undefined;
  connectionStatus?: AIAgentConnectionStatus | undefined;
}): AIAgent {
  const row: AIAgent = new AIAgent();
  row.id = ObjectID.generate();
  if (data.lastAlive) {
    row.lastAlive = data.lastAlive;
  }
  if (data.connectionStatus) {
    row.connectionStatus = data.connectionStatus;
  }
  return row;
}

interface FindCall {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  props: Record<string, unknown>;
}

describe("the Runners of repositories that pick none", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a global Runner is online while one has heartbeated within the Runner window, counted as OneUptime", async () => {
    const since: Array<Date> = [];
    jest
      .spyOn(QueryHelper, "greaterThan")
      .mockImplementation((value: unknown): never => {
        since.push(value as Date);
        return { greaterThan: value } as never;
      });
    const count: jest.SpyInstance = jest
      .spyOn(RunnerService, "countBy")
      .mockResolvedValue(new PositiveNumber(1) as never);

    const before: number = OneUptimeDate.getSomeMinutesAgo(
      RUNNER_ALIVE_WINDOW_IN_MINUTES,
    ).getTime();

    expect(await RunnerService.hasOnlineGlobalRunner()).toBe(true);

    const after: number = OneUptimeDate.getSomeMinutesAgo(
      RUNNER_ALIVE_WINDOW_IN_MINUTES,
    ).getTime();

    const call: { query: Record<string, unknown>; props: unknown } = count
      .mock.calls[0]![0] as { query: Record<string, unknown>; props: unknown };

    expect(call.query).toEqual({
      isGlobalRunner: true,
      lastAlive: { greaterThan: since[0] },
    });
    expect(call.props).toEqual({ isRoot: true });
    expect(since).toHaveLength(1);
    expect(since[0]!.getTime()).toBeGreaterThanOrEqual(before);
    expect(since[0]!.getTime()).toBeLessThanOrEqual(after);

    count.mockResolvedValue(new PositiveNumber(0) as never);

    expect(await RunnerService.hasOnlineGlobalRunner()).toBe(false);
  });

  test("a global AI agent is no Runner for code any more: the agent service offers none of those lookups", () => {
    const service: Record<string, unknown> = AIAgentService as unknown as Record<
      string,
      unknown
    >;

    for (const removed of [
      "findGlobalCodeRunners",
      "hasOnlineGlobalCodeRunner",
      "findGlobalAIAgentToTakeOver",
      "getAIAgentForProject",
      "getConnectedAIAgentForProject",
    ]) {
      expect(service[removed]).toBeUndefined();
    }
  });

  test("an agent of the project's own is the first one alive among its project's agents", async () => {
    const alive: AIAgent = agent({
      connectionStatus: AIAgentConnectionStatus.Connected,
    });
    const find: jest.SpyInstance = jest
      .spyOn(AIAgentService, "findBy")
      .mockResolvedValue([agent({}), alive]);

    expect(await AIAgentService.getOnlineProjectAIAgent(PROJECT_ID)).toBe(
      alive,
    );

    const call: FindCall = find.mock.calls[0]![0] as FindCall;

    // Only the project's own agents: a global agent is not the project's.
    expect(call.query).toEqual({ projectId: PROJECT_ID });
    expect(Object.keys(call.select)).not.toContain("key");
    expect(call.props).toEqual({ isRoot: true });

    find.mockResolvedValue([
      agent({ lastAlive: OneUptimeDate.getSomeMinutesAgo(10) }),
    ]);

    expect(await AIAgentService.getOnlineProjectAIAgent(PROJECT_ID)).toBeNull();
  });
});
