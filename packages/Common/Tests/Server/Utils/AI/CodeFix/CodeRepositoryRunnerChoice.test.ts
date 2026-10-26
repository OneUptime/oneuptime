import CodeRepositoryRunnerChoice, {
  CODE_REPOSITORY_RUNNER_SELECT,
  CodeRepositoryRunnerFactsRow,
  CodeRepositoryRunnerStatus,
  getCodeRepositoryRunnerFactsRow,
} from "../../../../../Server/Utils/AI/CodeFix/CodeRepositoryRunnerChoice";
import AIAgentService from "../../../../../Server/Services/AIAgentService";
import CodeRepositoryService from "../../../../../Server/Services/CodeRepositoryService";
import RunnerService from "../../../../../Server/Services/RunnerService";
import QueryHelper from "../../../../../Server/Types/Database/QueryHelper";
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
import { FindOperator } from "typeorm";

/*
 * WHERE AI WORKS IN A REPOSITORY, AS THE SERVER READS IT.
 *
 * The pure rule (Types/Runner/CodeRepositoryRunner, its own suite) decides
 * by the default order: the Runner a repository picks, then - for one that
 * picks none and did not pick the Global Runner - its project's default
 * Runner, then a global Runner while the project uses them. This reader
 * fetches the facts as OneUptime, each only when the order reaches it, and
 * answers the questions the rest of the server asks:
 *
 *   - may this worker work in the repository (the repository token);
 *   - does AI work in a repository on this Runner - a repository picks it,
 *     or follows it as the project's default (whether it takes code work at
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
const DEFAULT_RUNNER_ID: ObjectID = new ObjectID(
  "5a0b1c2d-4444-4222-8333-944455556666",
);

function runnerRow(data: {
  id?: ObjectID | undefined;
  lastAlive?: Date | undefined;
  name?: string | undefined;
  inCluster?: boolean | undefined;
}): Runner {
  const runner: Runner = new Runner();
  runner.id = data.id || RUNNER_ID;
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

/*
 * Whether a query value is QueryHelper.isNull(): a raw operator that reads
 * "IS NULL" (each call builds a new one, so it is read, not compared).
 */
function isNullQuery(value: unknown): boolean {
  if (!(value instanceof FindOperator)) {
    return false;
  }

  const getSql: unknown = (value as unknown as { getSql?: unknown }).getSql;

  return (
    typeof getSql === "function" &&
    (getSql as (alias: string) => string)("x") === "(x IS NULL)"
  );
}

// The facts of a repository: a pick, a pick of the Global Runner, or none.
function facts(
  data: {
    runnerId?: ObjectID | string | null | undefined;
    picksGlobalRunner?: boolean | null | undefined;
    projectId?: ObjectID | undefined | null;
  } = {},
): CodeRepositoryRunnerFactsRow {
  return {
    projectId:
      data.projectId === null ? undefined : data.projectId || PROJECT_ID,
    runnerId: data.runnerId,
    isGlobalRunnerPicked: data.picksGlobalRunner,
  };
}

describe("CodeRepositoryRunnerChoice", () => {
  let usesGlobalRunners: jest.SpyInstance;
  let projectDefault: jest.SpyInstance;
  let projectAgent: jest.SpyInstance;
  let globalOnline: jest.SpyInstance;

  beforeEach(() => {
    usesGlobalRunners = jest
      .spyOn(GlobalRunnerChoice, "doesProjectUseGlobalRunners")
      .mockResolvedValue(true);
    // No default Runner unless a test gives the project one.
    projectDefault = jest
      .spyOn(GlobalRunnerChoice, "findProjectDefaultRunnerId")
      .mockResolvedValue("");
    projectAgent = jest
      .spyOn(AIAgentService, "getOnlineProjectAIAgent")
      .mockResolvedValue(null);
    globalOnline = jest
      .spyOn(RunnerService, "hasOnlineGlobalRunner")
      .mockResolvedValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("the facts a repository is read with", () => {
    test("the rule's columns, for a read of the repository", () => {
      expect(CODE_REPOSITORY_RUNNER_SELECT).toEqual({
        projectId: true,
        runnerId: true,
        isGlobalRunnerPicked: true,
      });
    });

    test("a repository read with them hands over all three", () => {
      const row: CodeRepository = repository(RUNNER_ID);
      row.projectId = PROJECT_ID;
      row.isGlobalRunnerPicked = true;

      expect(getCodeRepositoryRunnerFactsRow(row)).toEqual({
        projectId: PROJECT_ID,
        runnerId: row.runnerId,
        isGlobalRunnerPicked: true,
      });
    });
  });

  describe("decideForRepository", () => {
    test("a pick wins, and neither the project's default nor its switch is even read", async () => {
      usesGlobalRunners.mockResolvedValue(false);
      projectDefault.mockResolvedValue(DEFAULT_RUNNER_ID.toString());

      expect(
        await CodeRepositoryRunnerChoice.decideForRepository(
          facts({ runnerId: RUNNER_ID }),
        ),
      ).toEqual({
        kind: CodeRepositoryRunnerChoiceKind.Custom,
        runnerId: RUNNER_ID.toString(),
      });
      expect(usesGlobalRunners).not.toHaveBeenCalled();
      expect(projectDefault).not.toHaveBeenCalled();
    });

    test("no pick, in a project with a default Runner: the default, and the project's switch is not read", async () => {
      projectDefault.mockResolvedValue(DEFAULT_RUNNER_ID.toString());

      expect(
        await CodeRepositoryRunnerChoice.decideForRepository(facts()),
      ).toEqual({
        kind: CodeRepositoryRunnerChoiceKind.ProjectDefault,
        runnerId: DEFAULT_RUNNER_ID.toString(),
      });
      expect(projectDefault).toHaveBeenCalledWith(PROJECT_ID);
      expect(usesGlobalRunners).not.toHaveBeenCalled();
    });

    test("the default is followed, not copied: another default moves the repository", async () => {
      projectDefault.mockResolvedValue(DEFAULT_RUNNER_ID.toString());

      expect(
        await CodeRepositoryRunnerChoice.decideForRepository(facts()),
      ).toEqual({
        kind: CodeRepositoryRunnerChoiceKind.ProjectDefault,
        runnerId: DEFAULT_RUNNER_ID.toString(),
      });

      projectDefault.mockResolvedValue(OTHER_RUNNER_ID.toString());

      expect(
        await CodeRepositoryRunnerChoice.decideForRepository(facts()),
      ).toEqual({
        kind: CodeRepositoryRunnerChoiceKind.ProjectDefault,
        runnerId: OTHER_RUNNER_ID.toString(),
      });
    });

    test("a repository that picked the Global Runner never follows the default, and it is not even read", async () => {
      projectDefault.mockResolvedValue(DEFAULT_RUNNER_ID.toString());

      expect(
        await CodeRepositoryRunnerChoice.decideForRepository(
          facts({ picksGlobalRunner: true }),
        ),
      ).toEqual({ kind: CodeRepositoryRunnerChoiceKind.Global });
      expect(projectDefault).not.toHaveBeenCalled();

      usesGlobalRunners.mockResolvedValue(false);

      expect(
        await CodeRepositoryRunnerChoice.decideForRepository(
          facts({ picksGlobalRunner: true }),
        ),
      ).toEqual({ kind: CodeRepositoryRunnerChoiceKind.NoRunner });
    });

    test("a Global Runner pick stored false, or unset, follows the default", async () => {
      projectDefault.mockResolvedValue(DEFAULT_RUNNER_ID.toString());

      for (const picksGlobalRunner of [false, null, undefined]) {
        expect(
          (
            await CodeRepositoryRunnerChoice.decideForRepository(
              facts({ picksGlobalRunner }),
            )
          ).kind,
        ).toBe(CodeRepositoryRunnerChoiceKind.ProjectDefault);
      }
    });

    test("no pick and no default, in a project that uses global Runners: a global Runner", async () => {
      expect(
        await CodeRepositoryRunnerChoice.decideForRepository(
          facts({ runnerId: null }),
        ),
      ).toEqual({ kind: CodeRepositoryRunnerChoiceKind.Global });
      expect(usesGlobalRunners).toHaveBeenCalledWith(PROJECT_ID);
    });

    test("no pick and no default, in a project that turned global Runners off: no Runner", async () => {
      usesGlobalRunners.mockResolvedValue(false);

      expect(
        await CodeRepositoryRunnerChoice.decideForRepository(facts()),
      ).toEqual({ kind: CodeRepositoryRunnerChoiceKind.NoRunner });
    });

    test("no pick and no project to ask: never a global Runner, and nothing is read", async () => {
      expect(
        await CodeRepositoryRunnerChoice.decideForRepository(
          facts({ runnerId: "  ", projectId: null }),
        ),
      ).toEqual({ kind: CodeRepositoryRunnerChoiceKind.NoRunner });
      expect(usesGlobalRunners).not.toHaveBeenCalled();
      expect(projectDefault).not.toHaveBeenCalled();
    });
  });

  describe("mayWorkInRepository", () => {
    test("the picked Runner may, another Runner - the project's default too - and a global Runner may not", async () => {
      projectDefault.mockResolvedValue(DEFAULT_RUNNER_ID.toString());
      const picked: CodeRepositoryRunnerFactsRow = facts({
        runnerId: RUNNER_ID,
      });

      expect(
        await CodeRepositoryRunnerChoice.mayWorkInRepository({
          worker: { kind: CodeWorkerKind.ProjectRunner, id: RUNNER_ID },
          repository: picked,
        }),
      ).toBe(true);

      for (const id of [OTHER_RUNNER_ID, DEFAULT_RUNNER_ID]) {
        expect(
          await CodeRepositoryRunnerChoice.mayWorkInRepository({
            worker: { kind: CodeWorkerKind.ProjectRunner, id },
            repository: picked,
          }),
        ).toBe(false);
      }

      expect(
        await CodeRepositoryRunnerChoice.mayWorkInRepository({
          worker: { kind: CodeWorkerKind.GlobalRunner, id: OTHER_RUNNER_ID },
          repository: picked,
        }),
      ).toBe(false);
    });

    test("a repository that follows the project's default: the default Runner and an agent of the project's own, never another Runner or a global one", async () => {
      projectDefault.mockResolvedValue(DEFAULT_RUNNER_ID.toString());
      const follows: CodeRepositoryRunnerFactsRow = facts();

      expect(
        await CodeRepositoryRunnerChoice.mayWorkInRepository({
          worker: {
            kind: CodeWorkerKind.ProjectRunner,
            id: DEFAULT_RUNNER_ID,
          },
          repository: follows,
        }),
      ).toBe(true);
      expect(
        await CodeRepositoryRunnerChoice.mayWorkInRepository({
          worker: { kind: CodeWorkerKind.ProjectAgent, id: OTHER_RUNNER_ID },
          repository: follows,
        }),
      ).toBe(true);
      expect(
        await CodeRepositoryRunnerChoice.mayWorkInRepository({
          worker: { kind: CodeWorkerKind.ProjectRunner, id: RUNNER_ID },
          repository: follows,
        }),
      ).toBe(false);
      expect(
        await CodeRepositoryRunnerChoice.mayWorkInRepository({
          worker: { kind: CodeWorkerKind.GlobalRunner, id: OTHER_RUNNER_ID },
          repository: follows,
        }),
      ).toBe(false);
    });

    test("once the default is another Runner, the old default may not work in it any more", async () => {
      projectDefault.mockResolvedValue(OTHER_RUNNER_ID.toString());

      expect(
        await CodeRepositoryRunnerChoice.mayWorkInRepository({
          worker: {
            kind: CodeWorkerKind.ProjectRunner,
            id: DEFAULT_RUNNER_ID,
          },
          repository: facts(),
        }),
      ).toBe(false);
      expect(
        await CodeRepositoryRunnerChoice.mayWorkInRepository({
          worker: { kind: CodeWorkerKind.ProjectRunner, id: OTHER_RUNNER_ID },
          repository: facts(),
        }),
      ).toBe(true);
    });

    test("a repository that picked the Global Runner: a global Runner, never the project's default", async () => {
      projectDefault.mockResolvedValue(DEFAULT_RUNNER_ID.toString());
      const global: CodeRepositoryRunnerFactsRow = facts({
        picksGlobalRunner: true,
      });

      expect(
        await CodeRepositoryRunnerChoice.mayWorkInRepository({
          worker: { kind: CodeWorkerKind.GlobalRunner, id: OTHER_RUNNER_ID },
          repository: global,
        }),
      ).toBe(true);
      expect(
        await CodeRepositoryRunnerChoice.mayWorkInRepository({
          worker: {
            kind: CodeWorkerKind.ProjectRunner,
            id: DEFAULT_RUNNER_ID,
          },
          repository: global,
        }),
      ).toBe(false);
    });

    test("a repository that picks none in a project with no default: a global Runner while the project uses them", async () => {
      const none: CodeRepositoryRunnerFactsRow = facts();
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
      // The project's own Runners still need a pick, or to be its default.
      expect(
        await CodeRepositoryRunnerChoice.mayWorkInRepository({
          worker: { kind: CodeWorkerKind.ProjectRunner, id: RUNNER_ID },
          repository: none,
        }),
      ).toBe(false);
    });
  });

  describe("doesRunnerWorkInARepository", () => {
    test("counts the repositories of the Runner's own project that pick it, as OneUptime", async () => {
      const count: jest.SpyInstance = jest
        .spyOn(CodeRepositoryService, "countBy")
        .mockResolvedValue(new PositiveNumber(2));

      expect(
        await CodeRepositoryRunnerChoice.doesRunnerWorkInARepository({
          id: RUNNER_ID,
          projectId: PROJECT_ID,
        }),
      ).toBe(true);

      expect(count).toHaveBeenCalledWith({
        query: { projectId: PROJECT_ID, runnerId: RUNNER_ID },
        props: { isRoot: true },
      });
      // A pick is enough: the default is not read.
      expect(projectDefault).not.toHaveBeenCalled();
    });

    test("a Runner no repository picks, that is not the project's default, works in none", async () => {
      jest
        .spyOn(CodeRepositoryService, "countBy")
        .mockResolvedValue(new PositiveNumber(0));
      projectDefault.mockResolvedValue(DEFAULT_RUNNER_ID.toString());

      expect(
        await CodeRepositoryRunnerChoice.doesRunnerWorkInARepository({
          id: RUNNER_ID,
          projectId: PROJECT_ID,
        }),
      ).toBe(false);
    });

    test("the project's default Runner works in the repositories that follow it", async () => {
      const count: jest.SpyInstance = jest
        .spyOn(CodeRepositoryService, "countBy")
        .mockImplementation(
          async (data: {
            query: { runnerId?: unknown };
          }): Promise<PositiveNumber> => {
            // None picks it; one picks none and has never picked Global.
            return new PositiveNumber(
              data.query.runnerId instanceof ObjectID ? 0 : 1,
            );
          },
        );
      projectDefault.mockResolvedValue(DEFAULT_RUNNER_ID.toString());

      expect(
        await CodeRepositoryRunnerChoice.doesRunnerWorkInARepository({
          id: DEFAULT_RUNNER_ID,
          projectId: PROJECT_ID,
        }),
      ).toBe(true);
      expect(projectDefault).toHaveBeenCalledWith(PROJECT_ID);

      // The project's repositories that pick none and never picked Global.
      const follows: { query: Record<string, unknown> } = count.mock
        .calls[1]![0] as { query: Record<string, unknown> };

      expect(follows.query["projectId"]).toEqual(PROJECT_ID);
      expect(isNullQuery(follows.query["runnerId"])).toBe(true);
      expect(isNullQuery(follows.query["isGlobalRunnerPicked"])).toBe(true);
      expect(Object.keys(follows.query).sort()).toEqual([
        "isGlobalRunnerPicked",
        "projectId",
        "runnerId",
      ]);
    });

    test("a repository whose Global Runner pick is stored false follows the default too", async () => {
      const queries: Array<unknown> = [];

      jest
        .spyOn(CodeRepositoryService, "countBy")
        .mockImplementation(
          async (data: {
            query: { isGlobalRunnerPicked?: unknown };
          }): Promise<PositiveNumber> => {
            queries.push(data.query.isGlobalRunnerPicked);
            return new PositiveNumber(
              data.query.isGlobalRunnerPicked === false ? 1 : 0,
            );
          },
        );
      projectDefault.mockResolvedValue(DEFAULT_RUNNER_ID.toString());

      expect(
        await CodeRepositoryRunnerChoice.doesRunnerWorkInARepository({
          id: DEFAULT_RUNNER_ID,
          projectId: PROJECT_ID,
        }),
      ).toBe(true);
      // The pick, then unset, then false: never true.
      expect(queries).toHaveLength(3);
      expect(queries[0]).toBeUndefined();
      expect(isNullQuery(queries[1])).toBe(true);
      expect(queries[2]).toBe(false);
      expect(isNullQuery(QueryHelper.isNull())).toBe(true);
    });

    test("the default Runner of a project whose every repository picked a Runner or the Global Runner works in none", async () => {
      jest
        .spyOn(CodeRepositoryService, "countBy")
        .mockResolvedValue(new PositiveNumber(0));
      projectDefault.mockResolvedValue(DEFAULT_RUNNER_ID.toString());

      expect(
        await CodeRepositoryRunnerChoice.doesRunnerWorkInARepository({
          id: DEFAULT_RUNNER_ID,
          projectId: PROJECT_ID,
        }),
      ).toBe(false);
    });

    test("a Runner with no project (a global Runner) works in none, and nothing is read", async () => {
      const count: jest.SpyInstance = jest.spyOn(
        CodeRepositoryService,
        "countBy",
      );

      expect(
        await CodeRepositoryRunnerChoice.doesRunnerWorkInARepository({
          id: RUNNER_ID,
        }),
      ).toBe(false);
      expect(
        await CodeRepositoryRunnerChoice.doesRunnerWorkInARepository({
          projectId: PROJECT_ID,
        }),
      ).toBe(false);
      expect(count).not.toHaveBeenCalled();
      expect(projectDefault).not.toHaveBeenCalled();
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
        await CodeRepositoryRunnerChoice.getStatusForRepository(
          facts({ runnerId: RUNNER_ID }),
        );

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

    test("a picked Runner silent for longer than five minutes is offline, and no agent covers for it", async () => {
      projectAgent.mockResolvedValue(new AIAgent());
      jest
        .spyOn(RunnerService, "findOneBy")
        .mockResolvedValue(
          runnerRow({ lastAlive: OneUptimeDate.getSomeMinutesAgo(6) }),
        );

      expect(
        (
          await CodeRepositoryRunnerChoice.getStatusForRepository(
            facts({ runnerId: RUNNER_ID }),
          )
        ).isOnline,
      ).toBe(false);
    });

    test("a pick that is not one of the project's Runners any more is offline, and unnamed", async () => {
      jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(null);

      const status: CodeRepositoryRunnerStatus =
        await CodeRepositoryRunnerChoice.getStatusForRepository(
          facts({ runnerId: RUNNER_ID }),
        );

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
          await CodeRepositoryRunnerChoice.getStatusForRepository(
            facts({ runnerId: RUNNER_ID }),
          )
        ).isOnline,
      ).toBe(false);
    });

    test("following the project's default: online while that Runner heartbeats, by its name", async () => {
      projectDefault.mockResolvedValue(DEFAULT_RUNNER_ID.toString());
      const find: jest.SpyInstance = jest
        .spyOn(RunnerService, "findOneBy")
        .mockResolvedValue(
          runnerRow({
            id: DEFAULT_RUNNER_ID,
            name: "build-box",
            lastAlive: OneUptimeDate.getCurrentDate(),
          }),
        );

      const status: CodeRepositoryRunnerStatus =
        await CodeRepositoryRunnerChoice.getStatusForRepository(facts());

      expect(status).toEqual({
        decision: {
          kind: CodeRepositoryRunnerChoiceKind.ProjectDefault,
          runnerId: DEFAULT_RUNNER_ID.toString(),
        },
        runnerName: "build-box",
        isOnline: true,
      });
      expect(find).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { _id: DEFAULT_RUNNER_ID.toString(), projectId: PROJECT_ID },
        }),
      );
      // A global Runner online does not count for it.
      expect(globalOnline).not.toHaveBeenCalled();
    });

    test("following the project's default while it is offline: offline, by its name - unless an agent of the project's own is online", async () => {
      projectDefault.mockResolvedValue(DEFAULT_RUNNER_ID.toString());
      jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
        runnerRow({
          id: DEFAULT_RUNNER_ID,
          name: "build-box",
          lastAlive: OneUptimeDate.getSomeMinutesAgo(60),
        }),
      );

      expect(
        await CodeRepositoryRunnerChoice.getStatusForRepository(facts()),
      ).toEqual({
        decision: {
          kind: CodeRepositoryRunnerChoiceKind.ProjectDefault,
          runnerId: DEFAULT_RUNNER_ID.toString(),
        },
        runnerName: "build-box",
        isOnline: false,
      });

      projectAgent.mockResolvedValue(new AIAgent());

      expect(
        (await CodeRepositoryRunnerChoice.getStatusForRepository(facts()))
          .isOnline,
      ).toBe(true);
    });

    test("no pick and no default: online while a global Runner is, or an agent of the project's own", async () => {
      const none: CodeRepositoryRunnerFactsRow = facts();

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

    test("picked the Global Runner beside a default: online while a global Runner is", async () => {
      projectDefault.mockResolvedValue(DEFAULT_RUNNER_ID.toString());
      const find: jest.SpyInstance = jest.spyOn(RunnerService, "findOneBy");

      expect(
        await CodeRepositoryRunnerChoice.getStatusForRepository(
          facts({ picksGlobalRunner: true }),
        ),
      ).toEqual({
        decision: { kind: CodeRepositoryRunnerChoiceKind.Global },
        isOnline: true,
      });
      expect(find).not.toHaveBeenCalled();
    });

    test("no pick in a project without a default or global Runners: only an agent of the project's own", async () => {
      usesGlobalRunners.mockResolvedValue(false);
      const none: CodeRepositoryRunnerFactsRow = facts();

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
      jest
        .spyOn(CodeRepositoryService, "countBy")
        .mockResolvedValue(new PositiveNumber(0));

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
      jest
        .spyOn(CodeRepositoryService, "countBy")
        .mockResolvedValue(new PositiveNumber(0));
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

    test("or the project's default Runner, online, while a repository follows it", async () => {
      usesGlobalRunners.mockResolvedValue(false);
      projectDefault.mockResolvedValue(DEFAULT_RUNNER_ID.toString());
      jest
        .spyOn(CodeRepositoryService, "findBy")
        .mockResolvedValue([repository()]);
      const count: jest.SpyInstance = jest
        .spyOn(CodeRepositoryService, "countBy")
        .mockResolvedValue(new PositiveNumber(1));
      const find: jest.SpyInstance = jest
        .spyOn(RunnerService, "findOneBy")
        .mockResolvedValue(
          runnerRow({
            id: DEFAULT_RUNNER_ID,
            lastAlive: OneUptimeDate.getCurrentDate(),
          }),
        );

      expect(
        await CodeRepositoryRunnerChoice.isAnyRunnerOnlineForProject(
          PROJECT_ID,
        ),
      ).toBe(true);
      expect(find).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { _id: DEFAULT_RUNNER_ID.toString(), projectId: PROJECT_ID },
        }),
      );

      // No repository follows it: the default alone is not enough.
      count.mockResolvedValue(new PositiveNumber(0));
      find.mockClear();

      expect(
        await CodeRepositoryRunnerChoice.isAnyRunnerOnlineForProject(
          PROJECT_ID,
        ),
      ).toBe(false);
      expect(find).not.toHaveBeenCalled();
    });
  });
});
