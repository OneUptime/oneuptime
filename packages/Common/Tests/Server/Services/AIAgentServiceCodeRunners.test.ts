import AIAgentService from "../../../Server/Services/AIAgentService";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import AIAgent, {
  AIAgentConnectionStatus,
} from "../../../Models/DatabaseModels/AIAgent";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * WHAT WORKS IN A REPOSITORY THAT PICKS NO RUNNER.
 *
 * A code repository that picks none of its project's Runners works on a
 * global Runner for code - a global AI agent: the installation's bundled
 * Runner, OneUptime Cloud's fleet - while its project uses global Runners,
 * and on an AI agent of the project's own, from before Runners, either way.
 * These are what the server asks before handing such a repository's work
 * on: whether one is alive now.
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

describe("AIAgentService and the Runners of repositories that pick none", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the global Runners for code are the global agents, read with what tells whether each is alive and nothing else", async () => {
    const isNull: unknown = QueryHelper.isNull();
    jest.spyOn(QueryHelper, "isNull").mockReturnValue(isNull as never);
    const find: jest.SpyInstance = jest
      .spyOn(AIAgentService, "findBy")
      .mockResolvedValue([]);

    await AIAgentService.findGlobalCodeRunners();

    const call: FindCall = find.mock.calls[0]![0] as FindCall;

    expect(call.query).toEqual({ isGlobalAIAgent: true, projectId: isNull });
    expect(call.select).toEqual({
      _id: true,
      name: true,
      lastAlive: true,
      connectionStatus: true,
    });
    expect(Object.keys(call.select)).not.toContain("key");
    expect(call.props).toEqual({ isRoot: true });
  });

  test("a global Runner for code is online while one of them is alive", async () => {
    const find: jest.SpyInstance = jest
      .spyOn(AIAgentService, "findGlobalCodeRunners")
      .mockResolvedValue([
        agent({ lastAlive: OneUptimeDate.getSomeMinutesAgo(30) }),
      ]);

    expect(await AIAgentService.hasOnlineGlobalCodeRunner()).toBe(false);

    find.mockResolvedValue([
      agent({ lastAlive: OneUptimeDate.getSomeMinutesAgo(30) }),
      agent({ lastAlive: OneUptimeDate.getCurrentDate() }),
    ]);

    expect(await AIAgentService.hasOnlineGlobalCodeRunner()).toBe(true);

    find.mockResolvedValue([]);

    expect(await AIAgentService.hasOnlineGlobalCodeRunner()).toBe(false);
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
