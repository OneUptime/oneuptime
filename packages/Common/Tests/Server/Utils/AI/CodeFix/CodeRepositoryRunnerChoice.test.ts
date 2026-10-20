import CodeRepositoryRunnerChoice, {
  CodeRepositoryRunnerStatus,
} from "../../../../../Server/Utils/AI/CodeFix/CodeRepositoryRunnerChoice";
import AIAgentService from "../../../../../Server/Services/AIAgentService";
import CodeRepositoryService from "../../../../../Server/Services/CodeRepositoryService";
import RunnerService from "../../../../../Server/Services/RunnerService";
import GlobalRunnerChoice from "../../../../../Server/Utils/Runner/GlobalRunnerChoice";
import AIAgent from "../../../../../Models/DatabaseModels/AIAgent";
import CodeRepository from "../../../../../Models/DatabaseModels/CodeRepository";
import Runner from "../../../../../Models/DatabaseModels/Runner";
import OneUptimeDate from "../../../../../Types/Date";
import ObjectID from "../../../../../Types/ObjectID";
import PositiveNumber from "../../../../../Types/PositiveNumber";
import {
  CodeRepositoryRunnerChoiceKind,
  CodeWorkerKind,
} from "../../../../../Types/Runner/CodeRepositoryRunner";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHERE AI WORKS IN A REPOSITORY, AS THE SERVER READS IT.
 *
 * The pure rule (Types/Runner/CodeRepositoryRunner, its own suite) decides
 * from two facts: the Runner a repository picks, and whether its project
 * uses global Runners. This reader fetches them as OneUptime - the
 * project's switch only for a repository that picks none, since a pick
 * always wins - and answers the questions the rest of the server asks:
 *
 *   - may this worker work in the repository (the repository token);
 *   - does any repository pick this Runner (whether it takes code work at
 *     all: its heartbeat capability and code-fix identity);
 *   - is what the repository runs on online (Code's gate, the exception
 *     page's checklist, the queue sweeper).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5a0b1c2d-1111-4222-8333-944455556666",
);
const RUNNER_ID: ObjectID = new ObjectID(
  "5a0b1c2d-2222-4222-8333-944455556666",
);
const OTHER_RUNNER_ID: ObjectID = new ObjectID(
  "5a0b1c2d-3333-4222-8333-944455556666",
);

function runnerRow(data: {
  lastAlive?: Date | undefined;
  name?: string | undefined;
  inCluster?: boolean | undefined;
}): Runner {
  const runner: Runner = new Runner();
  runner.id = RUNNER_ID;
  runner.name = data.name || "office-runner";
  if (data.lastAlive) {
    runner.lastAlive = data.lastAlive;
  }
  if (data.inCluster) {
    runner.hostInfo = {
      kubernetes: { inCluster: true, clusterIdentifier: "prod-eu" },
    };
  }
  return runner;
}

function repository(runnerId?: ObjectID | string): CodeRepository {
  const row: CodeRepository = new CodeRepository();
  row.id = ObjectID.generate();
  if (runnerId) {
    row.runnerId = new ObjectID(runnerId.toString());
  }
  return row;
}

describe("CodeRepositoryRunnerChoice", () => {
  let usesGlobalRunners: jest.SpyInstance;
  let projectAgent: jest.SpyInstance;
  let globalOnline: jest.SpyInstance;

  beforeEach(() => {
    usesGlobalRunners = jest
      .spyOn(GlobalRunnerChoice, "doesProjectUseGlobalRunners")
      .mockResolvedValue(true);
    projectAgent = jest
      .spyOn(AIAgentService, "getOnlineProjectAIAgent")
      .mockResolvedValue(null);
    globalOnline = jest
      .spyOn(AIAgentService, "hasOnlineGlobalCodeRunner")
      .mockResolvedValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("decideForRepository", () => {
    test("a pick wins, and the project's switch is not even read", async () => {
      usesGlobalRunners.mockResolvedValue(false);

      expect(
        await CodeRepositoryRunnerChoice.decideForRepository({
          projectId: PROJECT_ID,
          runnerId: RUNNER_ID,
        }),
      ).toEqual({
        kind: CodeRepositoryRunnerChoiceKind.Custom,
        runnerId: RUNNER_ID.toString(),
      });
      expect(usesGlobalRunners).not.toHaveBeenCalled();
    });

    test("no pick, in a project that uses global Runners: a global Runner", async () => {
      expect(
        await CodeRepositoryRunnerChoice.decideForRepository({
          projectId: PROJECT_ID,
          runnerId: null,
        }),
      ).toEqual({ kind: CodeRepositoryRunnerChoiceKind.Global });
      expect(usesGlobalRunners).toHaveBeenCalledWith(PROJECT_ID);
    });

    test("no pick, in a project that turned global Runners off: no Runner", async () => {
      usesGlobalRunners.mockResolvedValue(false);

      expect(
        await CodeRepositoryRunnerChoice.decideForRepository({
          projectId: PROJECT_ID,
        }),
      ).toEqual({ kind: CodeRepositoryRunnerChoiceKind.NoRunner });
    });

    test("no pick and no project to ask: never a global Runner", async () => {
      expect(
        await CodeRepositoryRunnerChoice.decideForRepository({
          runnerId: "  ",
        }),
      ).toEqual({ kind: CodeRepositoryRunnerChoiceKind.NoRunner });
      expect(usesGlobalRunners).not.toHaveBeenCalled();
    });
  });

  describe("mayWorkInRepository", () => {
    test("the picked Runner may, another Runner and a global Runner may not", async () => {
      const picked: { projectId: ObjectID; runnerId: ObjectID } = {
        projectId: PROJECT_ID,
        runnerId: RUNNER_ID,
      };

      expect(
        await CodeRepositoryRunnerChoice.mayWorkInRepository({
          worker: { kind: CodeWorkerKind.ProjectRunner, id: RUNNER_ID },
          repository: picked,
        }),
      ).toBe(true);
      expect(
        await CodeRepositoryRunnerChoice.mayWorkInRepository({
          worker: { kind: CodeWorkerKind.ProjectRunner, id: OTHER_RUNNER_ID },
          repository: picked,
        }),
      ).toBe(false);
      expect(
        await CodeRepositoryRunnerChoice.mayWorkInRepository({
          worker: { kind: CodeWorkerKind.GlobalRunner, id: OTHER_RUNNER_ID },
          repository: picked,
        }),
      ).toBe(false);
    });

    test("a repository that picks none: a global Runner while the project uses them", async () => {
      const none: { projectId: ObjectID } = { projectId: PROJECT_ID };
      const global: { kind: CodeWorkerKind; id: ObjectID } = {
        kind: CodeWorkerKind.GlobalRunner,
        id: OTHER_RUNNER_ID,
      };

      expect(
        await CodeRepositoryRunnerChoice.mayWorkInRepository({
          worker: global,
          repository: none,
        }),
      ).toBe(true);

      usesGlobalRunners.mockResolvedValue(false);

      expect(
        await CodeRepositoryRunnerChoice.mayWorkInRepository({
          worker: global,
          repository: none,
        }),
      ).toBe(false);
      // The project's own Runners still need a pick.
      expect(
        await CodeRepositoryRunnerChoice.mayWorkInRepository({
          worker: { kind: CodeWorkerKind.ProjectRunner, id: RUNNER_ID },
          repository: none,
        }),
      ).toBe(false);
    });
  });

  describe("isRunnerPickedByARepository", () => {
    test("counts the repositories of the Runner's own project that pick it, as OneUptime", async () => {
      const count: jest.SpyInstance = jest
        .spyOn(CodeRepositoryService, "countBy")
        .mockResolvedValue(new PositiveNumber(2));

      expect(
        await CodeRepositoryRunnerChoice.isRunnerPickedByARepository({
          id: RUNNER_ID,
          projectId: PROJECT_ID,
        }),
      ).toBe(true);

      expect(count).toHaveBeenCalledWith({
        query: { projectId: PROJECT_ID, runnerId: RUNNER_ID },
        props: { isRoot: true },
      });

      count.mockResolvedValue(new PositiveNumber(0));

      expect(
        await CodeRepositoryRunnerChoice.isRunnerPickedByARepository({
          id: RUNNER_ID,
          projectId: PROJECT_ID,
        }),
      ).toBe(false);
    });

    test("a Runner with no project (a global Runner) is picked by none, and nothing is read", async () => {
      const count: jest.SpyInstance = jest.spyOn(
        CodeRepositoryService,
        "countBy",
      );

      expect(
        await CodeRepositoryRunnerChoice.isRunnerPickedByARepository({
          id: RUNNER_ID,
        }),
      ).toBe(false);
      expect(
        await CodeRepositoryRunnerChoice.isRunnerPickedByARepository({
          projectId: PROJECT_ID,
        }),
      ).toBe(false);
      expect(count).not.toHaveBeenCalled();
    });
  });

  test("findRepositoriesPickingRunner reads the project's repositories that pick it, by name", async () => {
    const find: jest.SpyInstance = jest
      .spyOn(CodeRepositoryService, "findBy")
      .mockResolvedValue([]);

    await CodeRepositoryRunnerChoice.findRepositoriesPickingRunner({
      id: RUNNER_ID,
      projectId: PROJECT_ID,
    });

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { projectId: PROJECT_ID, runnerId: RUNNER_ID },
        select: { _id: true, name: true },
        props: { isRoot: true },
      }),
    );
  });

  describe("getStatusForRepository", () => {
    test("a picked Runner that heartbeats is online, by its name", async () => {
      const find: jest.SpyInstance = jest
        .spyOn(RunnerService, "findOneBy")
        .mockResolvedValue(
          runnerRow({ lastAlive: OneUptimeDate.getCurrentDate() }),
        );

      const status: CodeRepositoryRunnerStatus =
        await CodeRepositoryRunnerChoice.getStatusForRepository({
          projectId: PROJECT_ID,
          runnerId: RUNNER_ID,
        });

      expect(status).toEqual({
        decision: {
          kind: CodeRepositoryRunnerChoiceKind.Custom,
          runnerId: RUNNER_ID.toString(),
        },
        runnerName: "office-runner",
        isOnline: true,
      });
      // Read in the repository's own project only.
      expect(find).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { _id: RUNNER_ID.toString(), projectId: PROJECT_ID },
          props: { isRoot: true },
        }),
      );
      // A pick is never covered by a global Runner or an agent.
      expect(globalOnline).not.toHaveBeenCalled();
      expect(projectAgent).not.toHaveBeenCalled();
    });

    test("a picked Runner silent for longer than five minutes is offline", async () => {
      jest
        .spyOn(RunnerService, "findOneBy")
        .mockResolvedValue(
          runnerRow({ lastAlive: OneUptimeDate.getSomeMinutesAgo(6) }),
        );

      expect(
        (
          await CodeRepositoryRunnerChoice.getStatusForRepository({
            projectId: PROJECT_ID,
            runnerId: RUNNER_ID,
          })
        ).isOnline,
      ).toBe(false);
    });

    test("a pick that is not one of the project's Runners any more is offline, and unnamed", async () => {
      jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(null);

      const status: CodeRepositoryRunnerStatus =
        await CodeRepositoryRunnerChoice.getStatusForRepository({
          projectId: PROJECT_ID,
          runnerId: RUNNER_ID,
        });

      expect(status.isOnline).toBe(false);
      expect(status.runnerName).toBeUndefined();
    });

    test("an in-cluster Kubernetes agent Runner is never online for code, however alive", async () => {
      jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
        runnerRow({
          lastAlive: OneUptimeDate.getCurrentDate(),
          inCluster: true,
        }),
      );

      expect(
        (
          await CodeRepositoryRunnerChoice.getStatusForRepository({
            projectId: PROJECT_ID,
            runnerId: RUNNER_ID,
          })
        ).isOnline,
      ).toBe(false);
    });

    test("no pick: online while a global Runner is, or an agent of the project's own", async () => {
      const none: { projectId: ObjectID } = { projectId: PROJECT_ID };

      expect(
        await CodeRepositoryRunnerChoice.getStatusForRepository(none),
      ).toEqual({
        decision: { kind: CodeRepositoryRunnerChoiceKind.Global },
        isOnline: true,
      });

      globalOnline.mockResolvedValue(false);

      expect(
        (await CodeRepositoryRunnerChoice.getStatusForRepository(none))
          .isOnline,
      ).toBe(false);

      projectAgent.mockResolvedValue(new AIAgent());

      expect(
        (await CodeRepositoryRunnerChoice.getStatusForRepository(none))
          .isOnline,
      ).toBe(true);
    });

    test("no pick in a project without global Runners: only an agent of the project's own", async () => {
      usesGlobalRunners.mockResolvedValue(false);
      const none: { projectId: ObjectID } = { projectId: PROJECT_ID };

      const status: CodeRepositoryRunnerStatus =
        await CodeRepositoryRunnerChoice.getStatusForRepository(none);

      expect(status).toEqual({
        decision: { kind: CodeRepositoryRunnerChoiceKind.NoRunner },
        isOnline: false,
      });
      // A global Runner online does not count for it.
      expect(globalOnline).not.toHaveBeenCalled();

      projectAgent.mockResolvedValue(new AIAgent());

      expect(
        (await CodeRepositoryRunnerChoice.getStatusForRepository(none))
          .isOnline,
      ).toBe(true);
    });
  });

  describe("isAnyRunnerOnlineForProject", () => {
    test("an agent of the project's own is enough", async () => {
      projectAgent.mockResolvedValue(new AIAgent());
      const find: jest.SpyInstance = jest.spyOn(
        CodeRepositoryService,
        "findBy",
      );

      expect(
        await CodeRepositoryRunnerChoice.isAnyRunnerOnlineForProject(
          PROJECT_ID,
        ),
      ).toBe(true);
      expect(find).not.toHaveBeenCalled();
    });

    test("a global Runner online counts only while the project uses them", async () => {
      jest.spyOn(CodeRepositoryService, "findBy").mockResolvedValue([]);

      expect(
        await CodeRepositoryRunnerChoice.isAnyRunnerOnlineForProject(
          PROJECT_ID,
        ),
      ).toBe(true);

      usesGlobalRunners.mockResolvedValue(false);

      expect(
        await CodeRepositoryRunnerChoice.isAnyRunnerOnlineForProject(
          PROJECT_ID,
        ),
      ).toBe(false);
    });

    test("otherwise, a Runner one of its repositories picks, online", async () => {
      usesGlobalRunners.mockResolvedValue(false);
      jest
        .spyOn(CodeRepositoryService, "findBy")
        .mockResolvedValue([repository(), repository(RUNNER_ID)]);
      const find: jest.SpyInstance = jest
        .spyOn(RunnerService, "findOneBy")
        .mockResolvedValue(
          runnerRow({ lastAlive: OneUptimeDate.getCurrentDate() }),
        );

      expect(
        await CodeRepositoryRunnerChoice.isAnyRunnerOnlineForProject(
          PROJECT_ID,
        ),
      ).toBe(true);
      // Only the picked Runner was looked up.
      expect(find).toHaveBeenCalledTimes(1);

      find.mockResolvedValue(
        runnerRow({ lastAlive: OneUptimeDate.getSomeMinutesAgo(60) }),
      );

      expect(
        await CodeRepositoryRunnerChoice.isAnyRunnerOnlineForProject(
          PROJECT_ID,
        ),
      ).toBe(false);
    });
  });
});
