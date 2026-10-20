import CodeRepositoryService, {
  KUBERNETES_AGENT_RUNNER_FOR_CODE_MESSAGE,
  Service as CodeRepositoryServiceClass,
} from "../../../Server/Services/CodeRepositoryService";
import RunnerService from "../../../Server/Services/RunnerService";
import ProjectReferenceCheck, {
  ProjectReferenceColumn,
} from "../../../Server/Utils/Database/ProjectReferenceCheck";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import Runner from "../../../Models/DatabaseModels/Runner";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { afterEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A CODE REPOSITORY'S RUNNER SETTING (CodeRepository.runnerId).
 *
 * A repository picks the Runner AI works in it on, in its settings in
 * Code; empty means a global Runner. What it may pick:
 *
 *   - one of its own project's Runners only - never another project's, and
 *     never a global Runner, which belongs to no project: the project check
 *     every relation of the repository goes through (ProjectReferenceCheck)
 *     covers the Runner too;
 *   - never an in-cluster Runner the Kubernetes agent chart installed,
 *     which never clones a repository: the repository's own hooks refuse
 *     it, by the one agent-row rule (RunnerService.isKubernetesAgentRunnerRow);
 *   - and whoever may change the repository's other settings may change its
 *     Runner, and nobody else.
 */

const RUNNER_ID: string = "9e4f5a6b-1111-4222-8333-944455556666";

function runnerRow(data: { name: string; inCluster?: boolean }): Runner {
  const runner: Runner = new Runner();
  runner._id = RUNNER_ID;
  runner.name = data.name;
  if (data.inCluster) {
    runner.hostInfo = {
      kubernetes: { inCluster: true, clusterIdentifier: "prod-eu" },
    };
  }
  return runner;
}

describe("what a repository's Runner setting may name", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the Runner is a relation the project check covers, by its id column too", () => {
    const columns: Array<ProjectReferenceColumn> =
      ProjectReferenceCheck.getCheckedColumns(new CodeRepository());

    const runner: ProjectReferenceColumn | undefined = columns.find(
      (column: ProjectReferenceColumn): boolean => {
        return column.column === "runner";
      },
    );

    expect(runner).toBeDefined();
    expect(runner!.idColumn).toBe("runnerId");
    expect(runner!.isList).toBe(false);
    // Runner is tenant-scoped: a global Runner, of no project, is never one of the project's.
    expect(new Runner().getTenantColumn()).toBe("projectId");
  });

  test("a Runner the Kubernetes agent chart installed is refused, by its name or its posture", async () => {
    for (const runner of [
      runnerRow({ name: "kubernetes-agent/prod-eu" }),
      runnerRow({ name: "renamed", inCluster: true }),
    ]) {
      jest.spyOn(RunnerService, "findOneById").mockResolvedValue(runner);

      await expect(
        CodeRepositoryServiceClass.assertRunnerCanWorkInRepositories({
          runnerId: new ObjectID(RUNNER_ID),
        }),
      ).rejects.toThrow(
        new BadDataException(KUBERNETES_AGENT_RUNNER_FOR_CODE_MESSAGE),
      );
    }
  });

  test("the refusal is read as OneUptime, with only what the agent-row rule needs", async () => {
    const find: jest.SpyInstance = jest
      .spyOn(RunnerService, "findOneById")
      .mockResolvedValue(runnerRow({ name: "office-runner" }));

    await CodeRepositoryServiceClass.assertRunnerCanWorkInRepositories({
      runnerId: RUNNER_ID,
    });

    expect(find).toHaveBeenCalledTimes(1);

    const read: {
      id: ObjectID;
      select: Record<string, unknown>;
      props: Record<string, unknown>;
    } = find.mock.calls[0]![0] as {
      id: ObjectID;
      select: Record<string, unknown>;
      props: Record<string, unknown>;
    };

    expect(read.id.toString()).toBe(RUNNER_ID);
    expect(read.select).toEqual({ _id: true, name: true, hostInfo: true });
    expect(read.props).toEqual({ isRoot: true });
  });

  test("a Runner of the project's own, the relation's shape, and none at all are let through", async () => {
    const find: jest.SpyInstance = jest
      .spyOn(RunnerService, "findOneById")
      .mockResolvedValue(runnerRow({ name: "office-runner" }));

    await expect(
      CodeRepositoryServiceClass.assertRunnerCanWorkInRepositories({
        runner: { _id: RUNNER_ID },
      }),
    ).resolves.toBeUndefined();
    expect(find).toHaveBeenCalledTimes(1);

    find.mockClear();

    // Clearing the Runner (a global Runner) never needs a lookup.
    for (const data of [
      { runnerId: null },
      { runnerId: undefined },
      { name: "renamed repository" },
      undefined,
    ]) {
      await expect(
        CodeRepositoryServiceClass.assertRunnerCanWorkInRepositories(data),
      ).resolves.toBeUndefined();
    }

    // An id that is not one was refused before the hooks: not looked up.
    await CodeRepositoryServiceClass.assertRunnerCanWorkInRepositories({
      runnerId: "not-a-uuid",
    });

    expect(find).not.toHaveBeenCalled();
  });

  test("a Runner that is not there is left to the project check", async () => {
    jest.spyOn(RunnerService, "findOneById").mockResolvedValue(null);

    await expect(
      CodeRepositoryServiceClass.assertRunnerCanWorkInRepositories({
        runnerId: RUNNER_ID,
      }),
    ).resolves.toBeUndefined();
  });

  test("the create and update hooks check it after the project check", () => {
    const source: string = fs.readFileSync(
      path.join(__dirname, "../../../Server/Services/CodeRepositoryService.ts"),
      "utf8",
    );

    const create: string = source.slice(
      source.indexOf("protected override async onBeforeCreate"),
    );
    const update: string = source.slice(
      source.indexOf("protected override async onBeforeUpdate"),
    );

    for (const [hook, data] of [
      [create, "createBy.data"],
      [update, "updateBy.data"],
    ] as Array<[string, string]>) {
      const projectCheck: number = hook.indexOf("await super.onBefore");
      const runnerCheck: number = hook.indexOf(
        `await Service.assertRunnerCanWorkInRepositories(${data});`,
      );

      expect(projectCheck).toBeGreaterThanOrEqual(0);
      expect(runnerCheck).toBeGreaterThan(projectCheck);
    }

    expect(CodeRepositoryService).toBeDefined();
  });

  test("whoever may change the repository's settings may change its Runner, and nobody else", () => {
    const repository: CodeRepository = new CodeRepository();
    const runner: ReturnType<typeof repository.getColumnAccessControlFor> =
      repository.getColumnAccessControlFor("runnerId");
    const commands: ReturnType<typeof repository.getColumnAccessControlFor> =
      repository.getColumnAccessControlFor("testCommand");

    expect(runner).toBeDefined();
    expect(runner).toEqual(commands);
    expect(repository.getColumnAccessControlFor("runner")).toEqual(commands);
    expect(runner!.update).toContain(Permission.EditCodeRepository);
  });
});
