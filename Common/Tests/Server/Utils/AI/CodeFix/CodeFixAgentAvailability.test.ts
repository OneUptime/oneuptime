import CodeFixAgentAvailability from "../../../../../Server/Utils/AI/CodeFix/CodeFixAgentAvailability";
import AIAgentService from "../../../../../Server/Services/AIAgentService";
import RunbookAgentService from "../../../../../Server/Services/RunbookAgentService";
import AIAgent from "../../../../../Models/DatabaseModels/AIAgent";
import RunbookAgent, {
  RunbookAgentConnectionStatus,
} from "../../../../../Models/DatabaseModels/RunbookAgent";
import ObjectID from "../../../../../Types/ObjectID";
import OneUptimeDate from "../../../../../Types/Date";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * Who counts as an online code-fix agent for a project. Two kinds of agent
 * pick up that work:
 *
 *   - an AIAgent row (in-cluster fleet / legacy per-project agents), and
 *   - a customer-installed OneUptime Runner (RunbookAgent row) with
 *     canRunCodeFixTasks enabled and a recent lastAlive heartbeat.
 *
 * The orphaned-run sweeper and readiness checks share this, so a project
 * served only by a Runner must never be told "no agent online" — that is
 * exactly the bug that used to fail queued runs out from under a Runner
 * that was polling all along.
 */

describe("CodeFixAgentAvailability.getOnlineAgentForProject", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a connected AIAgent wins and RunbookAgentService is never consulted", async () => {
    const projectId: ObjectID = ObjectID.generate();

    const aiAgentSpy: jest.SpyInstance = jest
      .spyOn(AIAgentService, "getConnectedAIAgentForProject")
      .mockResolvedValue({
        name: "cluster-fleet-agent",
      } as unknown as AIAgent);

    const runnerSpy: jest.SpyInstance = jest
      .spyOn(RunbookAgentService, "getOnlineCodeFixRunnerForProject")
      .mockResolvedValue({
        name: "should-not-be-consulted",
      } as unknown as RunbookAgent);

    const result: { name: string } | null =
      await CodeFixAgentAvailability.getOnlineAgentForProject(projectId);

    expect(result).toEqual({ name: "cluster-fleet-agent" });
    expect(aiAgentSpy).toHaveBeenCalledTimes(1);
    expect(aiAgentSpy).toHaveBeenCalledWith(projectId);
    expect(runnerSpy).not.toHaveBeenCalled();
  });

  test("no AIAgent + an online Runner returns the Runner's name", async () => {
    const projectId: ObjectID = ObjectID.generate();

    jest
      .spyOn(AIAgentService, "getConnectedAIAgentForProject")
      .mockResolvedValue(null);

    const runnerSpy: jest.SpyInstance = jest
      .spyOn(RunbookAgentService, "getOnlineCodeFixRunnerForProject")
      .mockResolvedValue({
        name: "warehouse-runner",
      } as unknown as RunbookAgent);

    const result: { name: string } | null =
      await CodeFixAgentAvailability.getOnlineAgentForProject(projectId);

    expect(result).toEqual({ name: "warehouse-runner" });
    expect(runnerSpy).toHaveBeenCalledTimes(1);
    expect(runnerSpy).toHaveBeenCalledWith(projectId);
  });

  test("no AIAgent + no online Runner returns null and hasOnlineAgentForProject is false", async () => {
    const projectId: ObjectID = ObjectID.generate();

    jest
      .spyOn(AIAgentService, "getConnectedAIAgentForProject")
      .mockResolvedValue(null);
    jest
      .spyOn(RunbookAgentService, "getOnlineCodeFixRunnerForProject")
      .mockResolvedValue(null);

    expect(
      await CodeFixAgentAvailability.getOnlineAgentForProject(projectId),
    ).toBeNull();
    expect(
      await CodeFixAgentAvailability.hasOnlineAgentForProject(projectId),
    ).toBe(false);
  });

  test("hasOnlineAgentForProject is true when any agent is online", async () => {
    jest
      .spyOn(AIAgentService, "getConnectedAIAgentForProject")
      .mockResolvedValue({ name: "agent" } as unknown as AIAgent);

    expect(
      await CodeFixAgentAvailability.hasOnlineAgentForProject(
        ObjectID.generate(),
      ),
    ).toBe(true);
  });

  test("an AIAgent with no name falls back to the 'AI agent' label", async () => {
    jest
      .spyOn(AIAgentService, "getConnectedAIAgentForProject")
      .mockResolvedValue({} as unknown as AIAgent);

    const result: { name: string } | null =
      await CodeFixAgentAvailability.getOnlineAgentForProject(
        ObjectID.generate(),
      );

    expect(result).toEqual({ name: "AI agent" });
  });

  test("a Runner with no name falls back to the 'Runner' label", async () => {
    jest
      .spyOn(AIAgentService, "getConnectedAIAgentForProject")
      .mockResolvedValue(null);
    jest
      .spyOn(RunbookAgentService, "getOnlineCodeFixRunnerForProject")
      .mockResolvedValue({} as unknown as RunbookAgent);

    const result: { name: string } | null =
      await CodeFixAgentAvailability.getOnlineAgentForProject(
        ObjectID.generate(),
      );

    expect(result).toEqual({ name: "Runner" });
  });
});

describe("RunbookAgentService.getOnlineCodeFixRunnerForProject", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("queries only Runners with canRunCodeFixTasks: true in the given project — a Runner without the capability is never counted", async () => {
    const projectId: ObjectID = ObjectID.generate();

    const findBySpy: jest.SpyInstance = jest
      .spyOn(RunbookAgentService, "findBy")
      .mockResolvedValue([]);

    await RunbookAgentService.getOnlineCodeFixRunnerForProject(projectId);

    expect(findBySpy).toHaveBeenCalledTimes(1);
    expect(findBySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          projectId: projectId,
          canRunCodeFixTasks: true,
        }),
      }),
    );
  });

  test("a Runner returned by the query is online", async () => {
    const runner: RunbookAgent = {
      name: "fresh-runner",
      lastAlive: OneUptimeDate.getSomeMinutesAgo(1),
    } as unknown as RunbookAgent;

    jest.spyOn(RunbookAgentService, "findBy").mockResolvedValue([runner]);

    const result: RunbookAgent | null =
      await RunbookAgentService.getOnlineCodeFixRunnerForProject(
        ObjectID.generate(),
      );

    expect(result).toBe(runner);
  });

  /*
   * The recency window is a QUERY predicate, never a post-filter on a sorted
   * row. Sorting by lastAlive DESC and inspecting the first row looks
   * equivalent but is not: Postgres orders NULLs FIRST on a DESC sort, so a
   * Runner row created and never started would be picked ahead of one
   * heartbeating right now, and the project would read as having no agent
   * while its Runner was polling. Asserting the predicate is what stops that
   * shape coming back.
   */
  test("the liveness window is enforced by the query, not by sorting rows", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(RunbookAgentService, "findBy")
      .mockResolvedValue([]);

    await RunbookAgentService.getOnlineCodeFixRunnerForProject(
      ObjectID.generate(),
    );

    const args: Record<string, unknown> = findBySpy.mock.calls[0]![0] as Record<
      string,
      unknown
    >;

    // A lastAlive predicate is present, so stale rows never leave the DB.
    expect(
      (args["query"] as Record<string, unknown>)["lastAlive"],
    ).toBeDefined();

    // And no lastAlive sort is relied upon.
    expect(args["sort"]).toBeUndefined();
  });

  /*
   * Liveness is judged on lastAlive ONLY, never connectionStatus: nothing
   * ever flips a Runner's connectionStatus back to Disconnected, so a row
   * that once connected would look Connected forever.
   */
  test("connectionStatus is not consulted — only lastAlive gates the query", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(RunbookAgentService, "findBy")
      .mockResolvedValue([
        {
          name: "connected-forever-runner",
          connectionStatus: RunbookAgentConnectionStatus.Connected,
        } as unknown as RunbookAgent,
      ]);

    await RunbookAgentService.getOnlineCodeFixRunnerForProject(
      ObjectID.generate(),
    );

    const query: Record<string, unknown> = (
      findBySpy.mock.calls[0]![0] as Record<string, unknown>
    )["query"] as Record<string, unknown>;

    expect(query["connectionStatus"]).toBeUndefined();
  });

  test("empty result returns null", async () => {
    jest.spyOn(RunbookAgentService, "findBy").mockResolvedValue([]);

    expect(
      await RunbookAgentService.getOnlineCodeFixRunnerForProject(
        ObjectID.generate(),
      ),
    ).toBeNull();
  });
});
